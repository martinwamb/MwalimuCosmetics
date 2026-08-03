/**
 * Main process.
 *
 * All database access lives here. The renderer runs sandboxed with no Node
 * integration and reaches this side only through the narrow, named channels
 * declared in the preload script — so the UI never holds a connection, a
 * credential, or a fragment of SQL.
 */

import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import * as path from "path";

import {
  Database,
  authenticate,
  getFormRights,
  getVisibleForms,
  loadSettings,
  getPeriodStatus,
  findUpcomingPeriodProblems,
  searchItems,
  getLowStock,
  getStockMovements,
  getSales,
  getSaleLines,
  getDaySummary,
  getPaymentMix,
  getDailyTrend,
  getTopProducts,
  getSupplierBalances,
  findUnbalancedEntries,
  verifyCryptoAvailable,
  type User,
} from "@mwalimu/fumas-core";

import { loadConfig, saveConfig, redactConfig, configPath, type AppConfig } from "./config";

let win: BrowserWindow | null = null;
let db: Database | null = null;
let config: AppConfig = loadConfig();

/** Set on successful login and used to authorise every later call. */
let currentUser: User | null = null;

function database(): Database {
  if (!db) {
    db = new Database({
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: config.mysqlUser,
      password: config.mysqlPassword,
      database: config.mysqlDatabase,
    }, config.queryPacingMs);
  }
  return db;
}

async function resetDatabase(): Promise<void> {
  const old = db;
  db = null;
  if (old) await old.close().catch(() => undefined);
}

/**
 * Guard for anything beyond login and configuration.
 *
 * Session state lives in the main process, not the renderer, so a renderer
 * that is confused or tampered with cannot promote itself.
 */
function requireUser(): User {
  if (!currentUser) throw new Error("Not signed in.");
  return currentUser;
}

function createWindow() {
  // Electron's stock File/Edit/View menu offers nothing here and only invites
  // someone at a counter to open developer tools by accident.
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#ffffff",
    show: false,
    title: "Mwalimu Cosmetics",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win?.show());

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

/** Errors reach the UI as plain messages; the stack stays in the main process. */
const handle = (channel: string, fn: (...args: any[]) => Promise<unknown>) => {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
};

// ── Startup self-check ───────────────────────────────────────────
// Verifies the environment can still do what the app depends on, at launch
// rather than in the middle of someone's work.
handle("app:selfCheck", async () => {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const cryptoOk = verifyCryptoAvailable();
  checks.push({
    name: "Password compatibility",
    ok: cryptoOk,
    detail: cryptoOk
      ? "Matches the format FumasV5 stores"
      : "This machine can no longer reproduce the legacy cipher — nobody would be able to sign in",
  });

  const configured = Boolean(config.mysqlHost && config.mysqlUser);
  checks.push({
    name: "Database configured",
    ok: configured,
    detail: configured ? `${config.mysqlUser}@${config.mysqlHost}:${config.mysqlPort}` : "Not set up yet",
  });

  let reachable = false;
  if (configured) {
    reachable = await database().ping().catch(() => false);
  }
  checks.push({
    name: "Database reachable",
    ok: reachable,
    detail: reachable ? `Connected to ${config.mysqlDatabase}` : "Could not connect",
  });

  if (reachable) {
    const rows = await database().query<{ ROUTINE_NAME: string }>(
      `SELECT ROUTINE_NAME FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME IN ('do_stock_transactions','get_smallest_qty')`,
      [config.mysqlDatabase],
    ).catch(() => []);
    const ok = rows.length === 2;
    checks.push({
      name: "Stock procedures present",
      ok,
      // Stock is only ever written through these, and they also maintain the
      // sq cache, so their absence would mean stock could not move correctly.
      detail: ok ? "do_stock_transactions and get_smallest_qty found"
                 : "Missing — stock could not be recorded correctly",
    });
  }

  return { checks, writesEnabled: config.writesEnabled };
});

// ── Configuration ────────────────────────────────────────────────
handle("config:get", async () => redactConfig(config));

handle("config:save", async (incoming: Partial<AppConfig> & { mysqlPassword?: string }) => {
  config = {
    ...config,
    ...incoming,
    // An omitted or blank password means "leave it as it is", so that saving
    // an unrelated setting cannot silently clear the credential.
    mysqlPassword: incoming.mysqlPassword ? incoming.mysqlPassword : config.mysqlPassword,
  };
  saveConfig(config);
  await resetDatabase();
  return redactConfig(config);
});

handle("config:testConnection", async (incoming: Partial<AppConfig> & { mysqlPassword?: string }) => {
  const probe = new Database({
    host: incoming.mysqlHost ?? config.mysqlHost,
    port: Number(incoming.mysqlPort ?? config.mysqlPort),
    user: incoming.mysqlUser ?? config.mysqlUser,
    password: incoming.mysqlPassword ? incoming.mysqlPassword : config.mysqlPassword,
    database: incoming.mysqlDatabase ?? config.mysqlDatabase,
  });
  try {
    const row = await probe.queryOne<{ v: string }>("SELECT VERSION() AS v");
    const users = await probe.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM users");
    return { version: String(row?.v ?? "unknown"), users: Number(users?.n ?? 0) };
  } finally {
    await probe.close().catch(() => undefined);
  }
});

handle("config:path", async () => configPath());

// ── Session ──────────────────────────────────────────────────────
handle("auth:login", async (usercode: string, password: string) => {
  const user = await authenticate(database(), usercode, password);
  if (!user) throw new Error("Incorrect username or password.");
  currentUser = user;

  const forms = await getVisibleForms(database(), user.usercode);
  return { user, forms };
});

handle("auth:logout", async () => { currentUser = null; return true; });

handle("auth:current", async () => currentUser);

handle("auth:rights", async (formName: string) =>
  getFormRights(database(), requireUser().usercode, formName));

// ── Read-only data ───────────────────────────────────────────────
handle("data:settings", async () => {
  requireUser();
  const s = await loadSettings(database());
  // The raw nauto row holds ~150 columns of unrelated configuration; the UI
  // has no use for it and it would only bloat every message.
  const { raw, ...rest } = s;
  return rest;
});

handle("data:periodStatus", async (date: string) => {
  requireUser();
  return getPeriodStatus(database(), date);
});

handle("data:upcomingPeriodProblems", async () => {
  requireUser();
  return findUpcomingPeriodProblems(database(), 45);
});

handle("data:searchItems", async (opts: any) => {
  requireUser();
  return searchItems(database(), opts ?? {});
});

handle("data:lowStock", async (limit: number) => {
  requireUser();
  return getLowStock(database(), limit ?? 50);
});

handle("data:stockMovements", async (code: string, limit: number) => {
  requireUser();
  return getStockMovements(database(), code, limit ?? 50);
});

handle("data:sales", async (opts: any) => {
  requireUser();
  return getSales(database(), opts);
});

handle("data:saleLines", async (receiptNo: string) => {
  requireUser();
  return getSaleLines(database(), receiptNo);
});

handle("data:daySummary", async (date: string) => {
  requireUser();
  return getDaySummary(database(), date);
});

handle("data:paymentMix", async (date: string) => {
  requireUser();
  return getPaymentMix(database(), date);
});

handle("data:dailyTrend", async (from: string, to: string) => {
  requireUser();
  return getDailyTrend(database(), from, to);
});

handle("data:topProducts", async (from: string, to: string, limit: number) => {
  requireUser();
  return getTopProducts(database(), from, to, limit ?? 10);
});

handle("data:supplierBalances", async (limit: number) => {
  requireUser();
  return getSupplierBalances(database(), limit ?? 100);
});

handle("data:unbalancedEntries", async (from: string, to: string) => {
  requireUser();
  return findUnbalancedEntries(database(), from, to, 50);
});

// ── Lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await resetDatabase();
  if (process.platform !== "darwin") app.quit();
});

process.on("unhandledRejection", (reason) => {
  dialog.showErrorBox("Unexpected error", String(reason));
});
