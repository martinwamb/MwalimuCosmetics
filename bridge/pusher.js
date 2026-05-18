/**
 * Mwalimu Cosmetics — Bridge Sync Agent
 * Version: 20260501-2
 *
 * Runs every 30 seconds via loop.ps1 / Task Scheduler.
 * Checks for a newer version from the server on every startup and self-updates.
 *
 * Data guarantees:
 *   totalSales     = SUM(pos_header.amount) WHERE posted=1 (confirmed paid only)
 *   draftSales     = SUM(pos_header.amount) WHERE posted=0 (unposted, money not received)
 *   tax            = SUM(pos_header.tax) WHERE posted=1
 *   purchases      = SUM(grn.gtotal) WHERE posted=1 (stock received today at cost)
 *   profit         = revenue from pos_details minus latest cost from grn_d per SKU
 *   payment breakdown = pos_payment_details (primary) + tyype fallback
 *   stock          = SUM(stran.qty) per product — full cumulative ledger
 *   products       = all unique SKUs ever sold, no date or row-count cutoff
 */

const mysql = require("mysql");
const https = require("https");
const http  = require("http");
const fs    = require("fs");

const AGENT_VERSION   = "20260514-10";
const MYSQL = {
  host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
  database: "mwalimuinvest", ssl: false, insecureAuth: true, connectTimeout: 8000,
};
const API             = "https://api.mwalimucosmetics.com";
const SECRET          = "mwalimu-sync-secret";
const CHECKPOINT_FILE = "C:\\MwalimuSync\\checkpoint.json";
const SELF_PATH       = "C:\\MwalimuSync\\pusher.js";

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function getDatesRange(start, end) {
  const dates = [];
  let cur = start;
  while (cur <= end) { dates.push(cur); cur = addDays(cur, 1); }
  return dates;
}
function cleanRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (v instanceof Date)        out[k] = v.toISOString();
    else if (Buffer.isBuffer(v))       out[k] = v.toString("base64");
    else                               out[k] = v;
  }
  return out;
}
const _logLines = [];
function log(msg) {
  const line = `[${new Date().toLocaleTimeString("en-KE")}] ${msg}`;
  console.log(line);
  _logLines.push(line);
  if (_logLines.length > 60) _logLines.shift();
}

function query(conn, sql, params, timeoutMs) {
  const spec = timeoutMs ? { sql, timeout: timeoutMs } : sql;
  return new Promise((res, rej) =>
    conn.query(spec, params || [], (e, r) => e ? rej(e) : res(r))
  );
}

function apiRequest(method, path, body, secret, token, timeoutMs) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: "api.mwalimucosmetics.com",
      path, method,
      headers: {
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        ...(secret ? { "x-sync-secret": secret } : {}),
        ...(token  ? { "Authorization": `Bearer ${token}` } : {}),
      },
    }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => res({ status: r.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", rej);
    req.setTimeout(timeoutMs || 20000, () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

const apiPost      = (path, body, secret, token) => apiRequest("POST", path, body, secret, token);
const apiPostLarge = (path, body, secret)        => apiRequest("POST", path, body, secret, null, 120000);
const apiGet       = (path, token)               => apiRequest("GET",  path, null,  null,  token);

function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")); }
  catch { return { txCount: -1, date: "", lastProductSync: 0 }; }
}
function saveCheckpoint(cp) {
  try { fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp)); } catch {}
}

// ── Self-update (write-only, no restart) ─────────────────────
// Downloads new pusher.js if the server has a newer version and writes it
// to disk. Does NOT restart — the loop.ps1 will pick up the new file on
// the next 30-second cycle naturally, avoiding concurrent-instance races.
// Only runs once per minute (not every 5s) to avoid wasting bandwidth on
// flaky connections.
async function checkForUpdate() {
  const cp = loadCheckpoint();
  if (Date.now() - (cp.lastUpdateCheck || 0) < 60000) return; // once per minute
  try {
    saveCheckpoint({ ...cp, lastUpdateCheck: Date.now() });
    const r = await apiRequest("GET", "/sync/agent-version", null, null, null, 5000); // 5s timeout
    if (r.status !== 200) return;
    const { version } = JSON.parse(r.body);
    if (version === AGENT_VERSION) return;

    log(`New agent version available (${version}). Downloading…`);
    const dl = await apiGet("/sync/agent/pusher.js", null);
    if (dl.status !== 200) { log("Download failed: " + dl.status); return; }

    fs.writeFileSync(SELF_PATH, dl.body, "utf8");
    log(`Agent updated to ${version}. New version runs on next cycle.`);
    // No spawn/restart — loop.ps1 picks up the new file in 30 seconds
  } catch (e) {
    log("Update check skipped (non-fatal): " + e.message);
  }
}

async function getSyncToken() {
  const r = await apiPost("/auth/login", { email: "wambugujusk@gmail.com", password: "Mwalimu2025!" });
  if (r.status === 200) return JSON.parse(r.body).token;
  throw new Error("Auth failed: " + r.body);
}

// ── 1. Build metrics from MySQL (read-only) ───────────────────
// costMap: { sku → latestCostPrice } built during hourly product sync.
// Passing null is safe — profit will show 0 until first hourly sync runs.
async function buildMetrics(conn, today, costMap) {
  log("Reading metrics from MySQL…");

  // Use range conditions (>= and <) instead of DATE(col) = ? so MySQL can use
  // the index on trandate/ddate without a full-table function scan.
  // This is the critical fix that prevents POS table locks during each refresh.
  const tomorrow = addDays(today, 1);
  const t0 = today    + " 00:00:00";
  const t1 = tomorrow + " 00:00:00";

  // Confirmed paid sales only (posted=1)
  const [paid] = await query(conn,
    `SELECT COUNT(*) AS transactions,
            COALESCE(SUM(amount), 0) AS totalSales,
            COALESCE(SUM(tax),    0) AS totalTax
     FROM pos_header
     WHERE trandate >= ? AND trandate < ? AND posted = 1 AND (is_return = 0 OR is_return IS NULL)`,
    [t0, t1]);

  // Unposted drafts (posted=0) — money not yet received
  const [draft] = await query(conn,
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(amount), 0) AS totalSales
     FROM pos_header
     WHERE trandate >= ? AND trandate < ? AND posted = 0 AND (is_return = 0 OR is_return IS NULL)`,
    [t0, t1]);

  // GRN purchases: stock received today at cost price
  const [grn] = await query(conn,
    `SELECT COALESCE(SUM(gtotal), 0) AS purchases
     FROM grn WHERE ddate >= ? AND ddate < ? AND posted = 1`,
    [t0, t1]);

  // Gross profit — uses the cached cost map built during the daily product sync.
  const soldItems = await query(conn,
    `SELECT pd.code, SUM(pd.qty) AS qty, ROUND(SUM(pd.total), 0) AS revenue
     FROM pos_details pd
     JOIN pos_header ph ON pd.receiptno = ph.receiptno
     WHERE ph.trandate >= ? AND ph.trandate < ? AND ph.posted = 1
       AND (ph.is_return = 0 OR ph.is_return IS NULL)
       AND pd.code IS NOT NULL AND pd.code != ''
     GROUP BY pd.code`,
    [t0, t1]);

  let profit = 0;
  if (soldItems.length > 0 && costMap) {
    for (const item of soldItems) {
      if (item.code in costMap) {
        profit += Number(item.revenue) - costMap[item.code] * Number(item.qty);
      }
    }
    profit = Math.round(profit);
  }

  // Payment breakdown
  const breakdown = await query(conn,
    `SELECT ppd.payname AS name,
            COUNT(DISTINCT ppd.receiptno) AS transactions,
            COALESCE(SUM(ppd.pamount), 0) AS total
     FROM pos_payment_details ppd
     JOIN pos_header ph ON ppd.receiptno = ph.receiptno
     WHERE ph.trandate >= ? AND ph.trandate < ? AND ph.posted = 1
       AND (ph.is_return = 0 OR ph.is_return IS NULL)
     GROUP BY ppd.paynumber, ppd.payname
     ORDER BY total DESC`,
    [t0, t1]);

  let cashSales = 0, mpesaSales = 0, otherSales = 0;
  for (const b of breakdown) {
    const t = Number(b.total);
    const n = (b.name || "").toUpperCase();
    if (n === "CASH") cashSales += t;
    else if (n === "MPESA") mpesaSales += t;
    else otherSales += t;
  }

  // Top 10 products by revenue (posted sales only)
  const topProducts = await query(conn,
    `SELECT d.code, MAX(d.description) AS name,
            SUM(d.qty) AS qtySold, ROUND(SUM(d.total), 0) AS revenue
     FROM pos_details d
     JOIN pos_header h ON d.receiptno = h.receiptno
     WHERE h.trandate >= ? AND h.trandate < ? AND h.posted = 1
       AND (h.is_return = 0 OR h.is_return IS NULL)
       AND d.code IS NOT NULL AND d.code != ''
     GROUP BY d.code ORDER BY revenue DESC LIMIT 10`,
    [t0, t1]);

  // Staff: net sales and returns shown separately
  const byStaff = await query(conn,
    `SELECT staff,
       SUM(CASE WHEN posted = 1 AND (is_return = 0 OR is_return IS NULL) THEN 1     ELSE 0 END) AS transactions,
       COALESCE(SUM(CASE WHEN posted = 1 AND (is_return = 0 OR is_return IS NULL) THEN amount ELSE 0 END), 0) AS sales,
       COALESCE(SUM(CASE WHEN is_return = 1 THEN amount ELSE 0 END), 0) AS returns
     FROM pos_header WHERE trandate >= ? AND trandate < ?
     GROUP BY staff ORDER BY sales DESC`,
    [t0, t1]);

  return {
    forDate:           today,
    transactions:      Number(paid.transactions),
    totalSales:        Number(paid.totalSales),
    tax:               Number(paid.totalTax),
    cashSales,
    mpesaSales,
    otherSales,
    draftTransactions: Number(draft.transactions),
    draftSales:        Number(draft.totalSales),
    purchases:         Number(grn.purchases),
    profit,
    paymentBreakdown:  breakdown.map(b => ({ name: b.name, transactions: Number(b.transactions), total: Number(b.total) })),
    topProducts:       topProducts.map(p => ({ code: p.code, name: p.name, qtySold: Number(p.qtySold), revenue: Number(p.revenue) })),
    byStaff:           byStaff.map(s => ({ staff: s.staff, transactions: Number(s.transactions), total: Number(s.sales), returns: Number(s.returns) })),
  };
}

async function pushMetrics(data) {
  log("Pushing metrics to server…");
  const r = await apiPost("/sync/metrics", data, SECRET);
  if (r.status === 200) {
    log(`Metrics pushed — ${data.transactions} txns, KES ${data.totalSales.toLocaleString("en-KE")} sales, KES ${data.profit.toLocaleString("en-KE")} profit`);
    return true;
  }
  log(`Metrics push failed [${r.status}]: ${r.body}`);
  return false;
}

// ── 2. Build product catalogue from MySQL (read-only) ─────────
// Heavy queries — runs at most once per hour (off-peak only) to protect MySQL.
// Also builds the cost map used by buildMetrics for profit calculation,
// so grn_d is queried here (hourly) rather than on every 30-second cycle.
async function buildProducts(conn) {
  log("Reading product catalogue from MySQL…");

  const soldProducts = await query(conn,
    `SELECT pd.code AS sku, MAX(pd.description) AS name,
            MAX(pd.price) AS price, MAX(pd.icateg) AS category
     FROM pos_details pd
     WHERE pd.code IS NOT NULL AND pd.code != '' AND pd.code != '0' AND pd.price > 0
     GROUP BY pd.code`);

  if (!soldProducts.length) { log("No products found."); return null; }

  // Ensure stran(CODE) index exists so GROUP BY doesn't do a full table scan.
  // First time this runs it will take 30-90s to build the index on a large table;
  // every subsequent call returns instantly (Duplicate key name → caught silently).
  log("Ensuring stran(CODE) index exists…");
  await query(conn, "ALTER TABLE stran ADD INDEX idx_stran_code (CODE)", [])
    .catch(e => {
      if (!e.message.includes("Duplicate")) log("stran index: " + e.message);
    });

  // Stock ledger — SUM(qty) over all stran movements (fast once index exists)
  const stockRows = await query(conn,
    `SELECT CODE AS sku, COALESCE(SUM(qty), 0) AS stockQty FROM stran GROUP BY CODE`,
    [], 60000)  // 60-second timeout safety net
    .catch(e => { log("stran query failed (" + e.message + ") — stock will be 0"); return []; });

  const stockMap = Object.create(null);
  for (const s of stockRows) stockMap[s.sku] = Number(s.stockQty);

  // Latest cost per SKU from GRN receipts — used for profit calculation.
  // Done here (hourly) not on every 30s metrics cycle so grn_d isn't hit constantly.
  const costRows = await query(conn,
    `SELECT d.code, d.uprice AS cost
     FROM grn_d d JOIN grn g ON d.no = g.no
     WHERE g.posted = 1
     ORDER BY g.ddate DESC`);

  const costMap = Object.create(null);
  for (const r of costRows) {
    if (!(r.code in costMap)) costMap[r.code] = Number(r.cost);
  }
  log(`Cost map built: ${Object.keys(costMap).length} SKUs with known cost.`);

  // Wholesale and special prices from the stock master table (sitems).
  // If the table or columns don't exist the query fails silently.
  const priceMap = Object.create(null); // { sku → { wholesale, special } }
  try {
    const sitemsRows = await query(conn,
      `SELECT CODE, PRICE2 AS wholesale, PRICE3 AS special FROM sitems WHERE CODE IS NOT NULL`);
    for (const r of sitemsRows) {
      priceMap[r.CODE] = {
        wholesale: r.wholesale > 0 ? Number(r.wholesale) : null,
        special:   r.special   > 0 ? Number(r.special)   : null,
      };
    }
    log(`Price map built: ${Object.keys(priceMap).length} SKUs with sitems data.`);
  } catch (e) {
    log("sitems price query skipped (non-fatal): " + e.message);
  }

  const products = soldProducts.map(p => ({
    sku:            p.sku,
    name:           p.name,
    price:          Number(p.price),
    cost:           costMap[p.sku] ?? 0,
    wholesalePrice: priceMap[p.sku]?.wholesale ?? null,
    specialPrice:   priceMap[p.sku]?.special   ?? null,
    category:       p.category || "Uncategorised",
    stockQty:       Math.max(0, Math.round(stockMap[p.sku] ?? 0)),
  }));

  return { products, costMap };
}

async function syncProducts(products) {
  log("Pushing product catalogue to server…");

  // Smaller batches (200) with a 2-minute timeout each — avoids ECONNRESET
  // on slow shop internet when uploading thousands of products.
  const BATCH = 200;
  let synced = 0;
  for (let i = 0; i < products.length; i += BATCH) {
    const batchNum = Math.floor(i / BATCH) + 1;
    const r = await apiPostLarge("/sync/products", { products: products.slice(i, i + BATCH) }, SECRET);
    if (r.status === 200) {
      synced += Math.min(BATCH, products.length - i);
      log(`  Batch ${batchNum} OK (${synced}/${products.length})`);
    } else {
      log(`  Batch ${batchNum} failed [${r.status}]: ${r.body.slice(0, 120)}`);
    }
  }
  log(`Products synced: ${synced} of ${products.length}`);
}

// ── Remote receipt printing ───────────────────────────────────
// Triggered by a print_receipt pending change from the dashboard POS.
// Formats the receipt as plain text and sends it to the Windows default
// printer via PowerShell Out-Printer — silent, no window, no extra packages.
async function printReceipt(payload) {
  const { receiptNo, date, items = [], total, amountPaid, changeDue, paymentDetails = {}, ref } = payload;

  const W = 42; // characters wide (80mm paper ~42 chars at 10pt Courier)
  const hr  = "-".repeat(W);
  const dhr = "=".repeat(W);
  const center = s => s.padStart(Math.floor((W + s.length) / 2)).padEnd(W);
  const row    = (l, r) => {
    const right = String(r);
    const left  = String(l).slice(0, W - right.length - 1).padEnd(W - right.length - 1);
    return left + " " + right;
  };

  const lines = [
    dhr,
    center("MWALIMU COSMETICS"),
    center("P.O. Box 1234, Nairobi"),
    dhr,
    row("Date:", new Date(date).toLocaleString("en-KE")),
    row("Receipt:", receiptNo || "PENDING"),
    hr,
    row("ITEM", "TOTAL"),
    hr,
    ...items.map(i => {
      const name = (i.name || "Item").slice(0, 28);
      const subtot = "KES " + (Number(i.unitPrice) * Number(i.qty)).toLocaleString("en-KE");
      const nameLine = `  ${name} x${i.qty}`;
      return row(nameLine, subtot);
    }),
    hr,
    row("TOTAL:", "KES " + Number(total).toLocaleString("en-KE")),
    row("PAID:", "KES " + Number(amountPaid).toLocaleString("en-KE")),
    ...(changeDue > 0 ? [row("CHANGE:", "KES " + Number(changeDue).toLocaleString("en-KE"))] : []),
    hr,
    ...Object.entries(paymentDetails)
      .filter(([k, v]) => v > 0 && k !== "ref")
      .map(([k, v]) => row("  " + k.toUpperCase(), "KES " + Number(v).toLocaleString("en-KE"))),
    ...(ref ? [row("  Ref:", ref)] : []),
    hr,
    center("Thank you for shopping with us!"),
    dhr,
    "", "", "", "", "", "", "", "", // 8 feed lines — clears past tear bar
  ];

  const text = lines.join("\r\n");
  const tmpFile = "C:\\MwalimuSync\\last_receipt.txt";

  const exec = require("child_process").exec;

  try {
    fs.writeFileSync(tmpFile, text, "ascii");

    // Step 1: find the default printer name via WMI (works from SYSTEM account)
    let printerName = null;
    try {
      const wmicOut = await new Promise((res) =>
        exec('wmic printer where "Default=True" get Name /format:list',
          { timeout: 6000 }, (_, stdout) => res(stdout || ""))
      );
      const m = wmicOut.match(/Name=(.+)/);
      if (m) printerName = m[1].trim();
    } catch {}

    // Step 2: ensure the printer is in the system-wide list (makes it accessible
    // to the SYSTEM account — needed because printers install per-user by default)
    if (printerName) {
      await new Promise(res =>
        exec(`rundll32 printui.dll,PrintUIEntry /ga /n "${printerName}"`,
          { timeout: 8000 }, () => res())
      );
    }

    // Step 3: print using explicit printer name via PowerShell Out-Printer.
    // Use single quotes inside the PowerShell string so printer names with
    // slashes, spaces or other special characters are passed safely.
    const safeName = printerName ? printerName.replace(/'/g, "''") : null;
    const printerArg = safeName ? ` -Name '${safeName}'` : "";
    await new Promise((res, rej) =>
      exec(
        `powershell -NoProfile -NonInteractive -Command "Get-Content '${tmpFile}' | Out-Printer${printerArg}"`,
        { timeout: 20000 },
        (err) => err ? rej(err) : res()
      )
    );
    log(`Receipt printed on: ${printerName || "default printer"}`);

  } catch (e) {
    log("Print failed: " + e.message);
    // Final fallback — notepad /p works on most Windows versions
    try {
      require("child_process").exec(`notepad /p "${tmpFile}"`);
      log("Receipt sent via notepad fallback.");
    } catch {}
  }
}

// ── Backup: ship today's MySQL tables to Hetzner ─────────────
// Used by the backup_request pending-change type (dashboard "Backup Now" button)
// and by the scheduled daily-backup.js task.
async function runDailyBackup(conn) {
  const today = kenyanDate();
  log(`=== Backup starting for ${today} ===`);

  const tables = [
    { name: "pos_header",          sql: `SELECT * FROM pos_header WHERE DATE(trandate) = ?`,         params: [today] },
    { name: "pos_details",         sql: `SELECT pd.* FROM pos_details pd JOIN pos_header ph ON pd.receiptno = ph.receiptno WHERE DATE(ph.trandate) = ?`, params: [today] },
    { name: "pos_payment_details", sql: `SELECT ppd.* FROM pos_payment_details ppd JOIN pos_header ph ON ppd.receiptno = ph.receiptno WHERE DATE(ph.trandate) = ?`, params: [today] },
    { name: "stran",               sql: `SELECT * FROM stran WHERE DATE(stdate) = ?`,                 params: [today] },
    { name: "grn",                 sql: `SELECT * FROM grn WHERE DATE(ddate) = ?`,                    params: [today] },
  ];

  for (const t of tables) {
    try {
      const rows = await query(conn, t.sql, t.params);
      const clean = rows.map(row => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          if (v === null || v === undefined) out[k] = null;
          else if (v instanceof Date)        out[k] = v.toISOString();
          else if (Buffer.isBuffer(v))       out[k] = v.toString("base64");
          else                               out[k] = v;
        }
        return out;
      });
      const r = await apiPostLarge("/sync/backup", { date: today, table: t.name, rows: clean }, SECRET);
      if (r.status === 200) {
        const parsed = JSON.parse(r.body);
        log(`  ${t.name}: ${parsed.rows} rows backed up.`);
      } else {
        log(`  ${t.name} backup failed [${r.status}]: ${r.body.slice(0, 100)}`);
      }
    } catch (e) {
      log(`  ${t.name} backup error: ${e.message}`);
    }
  }
  log("=== Backup complete ===");
}

// ── On-demand mirror batch ────────────────────────────────────
// Triggered by a mirror_run pending change from the dashboard.
// Syncs up to batchDays of historical MySQL data into PostgreSQL mirror tables.
// Checks the server-side pause flag between dates so the user can stop mid-batch.
const MIRROR_DATE_TABLES = [
  { name: "pos_header",
    sql:  "SELECT * FROM pos_header WHERE DATE(trandate) = ?",
    params: d => [d] },
  { name: "pos_details",
    sql:  `SELECT pd.* FROM pos_details pd
           JOIN pos_header ph ON pd.receiptno = ph.receiptno
           WHERE DATE(ph.trandate) = ?`,
    params: d => [d] },
  { name: "pos_payment_details",
    sql:  `SELECT ppd.* FROM pos_payment_details ppd
           JOIN pos_header ph ON ppd.receiptno = ph.receiptno
           WHERE DATE(ph.trandate) = ?`,
    params: d => [d] },
  { name: "stran",
    sql:  "SELECT * FROM stran WHERE DATE(stdate) = ?",
    params: d => [d] },
  { name: "grn",
    sql:  "SELECT * FROM grn WHERE DATE(ddate) = ?",
    params: d => [d] },
  { name: "grn_d",
    sql:  `SELECT gd.* FROM grn_d gd JOIN grn g ON gd.no = g.no
           WHERE DATE(g.ddate) = ?`,
    params: d => [d] },
];

async function isPaused() {
  try {
    const r = await apiRequest("GET", "/sync/mirror/paused", null, SECRET, null, 8000);
    return r.status === 200 && JSON.parse(r.body).paused === true;
  } catch { return false; }
}

async function runDailyMirrorBatch(conn, batchDays) {
  batchDays = Number(batchDays) || 10;
  log(`=== Mirror batch starting (${batchDays} days) ===`);

  if (await isPaused()) { log("Mirror is paused — skipping batch."); return; }

  // Get watermark from server
  const sr = await apiRequest("GET", "/sync/mirror/status", null, SECRET, null, 10000)
    .catch(() => ({ status: 0, body: '{"lastDate":null}' }));
  if (sr.status !== 200) { log("Cannot reach mirror/status."); return; }
  const { lastDate } = JSON.parse(sr.body);

  const today     = kenyanDate();
  const yesterday = addDays(today, -1);

  let startDate;
  if (lastDate) {
    startDate = addDays(lastDate, 1);
  } else {
    try {
      const [row] = await query(conn,
        "SELECT DATE(MIN(trandate)) AS earliest FROM pos_header WHERE trandate IS NOT NULL", []);
      startDate = row?.earliest
        ? new Date(row.earliest).toISOString().slice(0, 10)
        : addDays(today, -365);
    } catch { startDate = addDays(today, -365); }
    log(`Historical mirror starts from ${startDate}`);
  }

  if (startDate > yesterday) { log("Mirror is fully up to date."); return; }

  const allPending  = getDatesRange(startDate, yesterday);
  const batch       = allPending.slice(0, batchDays);
  const afterBatch  = allPending.length - batch.length;

  log(`Syncing ${batch.length} days: ${batch[0]} → ${batch[batch.length - 1]}` +
      (afterBatch > 0 ? ` (${afterBatch} days remain after this batch)` : " — will be fully caught up"));

  let lastSuccessful = lastDate;

  for (let i = 0; i < batch.length; i++) {
    const date = batch[i];

    // Check pause flag every 3 dates so user can stop mid-batch
    if (i > 0 && i % 3 === 0 && await isPaused()) {
      log(`Paused by user at ${date} (${i} of ${batch.length} dates done).`);
      break;
    }

    log(`  [${i + 1}/${batch.length}] ${date}`);
    let dateOk = true;

    for (const t of MIRROR_DATE_TABLES) {
      try {
        const rows  = await query(conn, t.sql, t.params(date), 30000);
        const clean = rows.map(cleanRow);

        // Upload in chunks of 500 rows to avoid 502 gateway errors on large tables
        const CHUNK = 500;
        let tableOk = true;
        for (let ci = 0; ci < Math.max(1, Math.ceil(clean.length / CHUNK)); ci++) {
          const chunk = clean.slice(ci * CHUNK, (ci + 1) * CHUNK);
          const r = await apiRequest("POST", "/sync/mirror/rows",
            { table: t.name, date, rows: chunk }, SECRET, null, 120000);
          if (r.status !== 200) {
            log(`    [!] ${t.name} chunk ${ci + 1}: server error ${r.status}`);
            tableOk = false; break;
          }
        }
        if (tableOk) {
          log(`    ${t.name}: ${clean.length} rows`);
        } else {
          dateOk = false;
        }
      } catch (e) {
        log(`    [!] ${t.name}: ${e.message}`); dateOk = false;
      }
    }

    if (dateOk) { lastSuccessful = date; }
    else { log(`Stopping at ${date} due to error.`); break; }
  }

  // Advance watermark
  if (lastSuccessful && lastSuccessful !== lastDate) {
    await apiRequest("POST", "/sync/mirror/status",
      { lastDate: lastSuccessful }, SECRET, null, 10000).catch(() => {});
    log(`Watermark → ${lastSuccessful}`);
  }

  log(`=== Mirror batch complete${afterBatch > 0 ? ` — ${afterBatch} days still pending` : " — history fully mirrored"} ===`);
}

// ── 3. Apply pending changes from cloud ──────────────────────
async function applyPendingChanges(conn, token) {
  const r = await apiGet("/sync/pending-changes", token);
  if (r.status !== 200) return;
  let changes;
  try { changes = JSON.parse(r.body); } catch { return; }
  if (!changes.length) return;

  log(`Applying ${changes.length} pending change(s)…`);
  for (const change of changes) {
    try {
      if (change.type === "stock_adjustment") {
        // Single product quantity adjustment — writes to stran ledger
        const { sku, delta, name, reason } = change.payload;
        await query(conn,
          `INSERT INTO stran (CODE, descr, stdate, qty, tt, trandesc, staff, source)
           VALUES (?, ?, CURDATE(), ?, 'ADJ', ?, 'WEB', 'WEB')`,
          [sku, name || sku, Number(delta), reason || "Web stock adjustment"]);

      } else if (change.type === "print_receipt") {
        await printReceipt(change.payload);

      } else if (change.type === "backup_request") {
        await runDailyBackup(conn);

      } else if (change.type === "mirror_run") {
        const { batchDays = 10 } = change.payload || {};
        await runDailyMirrorBatch(conn, batchDays);

      } else if (change.type === "goods_received") {
        // Goods received note — writes grn header, grn_d lines, and stran entries
        const { supplierName, lines } = change.payload;

        // Generate a unique WEB-prefixed GRN number (separate from POS GRN sequence)
        const [maxGrn] = await query(conn,
          "SELECT MAX(CAST(SUBSTRING(no, 4) AS UNSIGNED)) AS maxno FROM grn WHERE no LIKE 'WEB%'");
        const grnNo = `WEB${String((Number(maxGrn?.maxno) || 0) + 1).padStart(6, "0")}`;
        const today = kenyanDate();
        const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.costPrice), 0);

        // GRN header
        await query(conn,
          `INSERT INTO grn (no, scode, sname, ddate, posted, screate, dcreate, gtotal, exclvat)
           VALUES (?, 'WEB', ?, ?, 1, 'WEB', NOW(), ?, ?)`,
          [grnNo, supplierName || "Web Entry", today, Math.round(total), Math.round(total)]);

        for (const line of lines) {
          const lineTotal = Number(line.qty) * Number(line.costPrice);
          // GRN detail line
          await query(conn,
            `INSERT INTO grn_d (no, code, descr, qty, uprice, total) VALUES (?, ?, ?, ?, ?, ?)`,
            [grnNo, line.sku, line.name, Number(line.qty),
             Number(line.costPrice), Math.round(lineTotal)]);
          // Stock movement — positive qty = stock received
          await query(conn,
            `INSERT INTO stran (CODE, descr, stdate, qty, price, total, tt, trandesc, staff, source)
             VALUES (?, ?, ?, ?, ?, ?, 'r', 'Goods Received', 'WEB', 'WEB')`,
            [line.sku, line.name, today, Number(line.qty),
             Number(line.costPrice), Math.round(lineTotal)]);
        }
        log(`  GRN ${grnNo}: ${lines.length} line(s), KES ${Math.round(total).toLocaleString("en-KE")}`);
      }

      await apiPost("/sync/mark-change-applied", { id: change.id }, SECRET);
      log(`  Applied [${change.type}]`);
    } catch (e) {
      await apiPost("/sync/mark-change-failed", { id: change.id, error: e.message }, SECRET);
      log(`  Failed change ${change.id}: ${e.message}`);
    }
  }
}

// ── 4. Write back web-created sales to MySQL ─────────────────
async function writeBackSales(conn, token) {
  const r = await apiGet("/sync/unsynced-sales", token);
  if (r.status !== 200) { log("Could not fetch unsynced sales: " + r.body); return; }
  let sales;
  try { sales = JSON.parse(r.body); } catch { return; }
  if (!sales.length) { log("No unsynced web sales."); return; }

  log(`Writing ${sales.length} web sale(s) to MySQL…`);
  const [maxRct] = await query(conn, "SELECT MAX(CAST(receiptno AS UNSIGNED)) AS maxno FROM pos_header");
  let nextNo = (Number(maxRct.maxno) || 0) + 1;

  for (const sale of sales) {
    const rctNo = String(nextNo++).padStart(8, "0");
    const pd    = sale.paymentDetails || {};
    const now   = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const hasCash  = Number(pd.cash  || 0) > 0;
    const hasMpesa = Number(pd.mpesa || 0) > 0;
    const hasOther = Number(pd.coop || pd.equity_justann || pd.equity_mwalimu || pd.kcb || 0) > 0;
    const tyype    = hasCash && !hasMpesa && !hasOther ? "Cash Sale"
                   : !hasCash && hasMpesa && !hasOther ? "Mobile Money" : "Multiple";

    try {
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_header
           (receiptno,amount,paid,changee,tax,staff,arcode,arname,tyype,
            trandate,posdate,cash,mpesa,creditcard,cheque,posted,is_return,disc)
         VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,1,0,0)`,
        [rctNo, sale.total, sale.amountPaid, sale.changeDue,
         sale.staffCode || "WEB", "", "", tyype, now.slice(0, 10), now,
         Number(pd.cash || 0), Number(pd.mpesa || 0), 0, 0],
        (e) => e ? rej(e) : res()
      ));

      const ppdPayname = hasMpesa ? "MPESA" : hasOther ? "BANK" : "CASH";
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_payment_details (receiptno, payname, pamount) VALUES (?, ?, ?)`,
        [rctNo, ppdPayname, sale.total],
        (e) => e ? rej(e) : res()
      )).catch(() => {});

      for (const item of sale.items) {
        await new Promise((res, rej) => conn.query(
          `INSERT INTO pos_details (receiptno,code,description,qty,price,total,vat,posted,disc)
           VALUES (?,?,?,?,?,?,0,1,0)`,
          [rctNo, item.sku, item.productName, item.qty, item.unitPrice, item.unitPrice * item.qty],
          (e) => e ? rej(e) : res()
        ));
        await new Promise((res, rej) => conn.query(
          `INSERT INTO stran (CODE,descr,stdate,qty,price,total,tt,trandesc,staff,source)
           VALUES (?,?,?,?,?,?,'SALES','SALES',?,'WEB')`,
          [item.sku, item.productName, now.slice(0, 10), -item.qty,
           item.unitPrice, item.unitPrice * item.qty, sale.staffCode || "WEB"],
          (e) => e ? rej(e) : res()
        ));
      }

      await apiPost("/sync/mark-synced", { orderId: sale.id, mysqlReceiptNo: rctNo }, SECRET);
      log(`  Written: receipt ${rctNo}, KES ${sale.total}`);
    } catch (e) {
      log(`  Failed to write sale ${sale.id}: ${e.message}`);
    }
  }
}

function openConn() {
  return new Promise((res, rej) => {
    const c = mysql.createConnection(MYSQL);
    c.connect(e => e ? rej(e) : res(c));
  });
}

// ── Main ─────────────────────────────────────────────────────
async function run() {
  await checkForUpdate();

  // Check if a refresh was requested from the dashboard (cheap — no MySQL)
  // Short 10s timeout: fail fast on flaky wifi so the next loop cycle retries sooner.
  const refreshCheck = await apiRequest("GET", "/sync/pending-refresh", null, SECRET, null, 10000)
    .catch(() => ({ status: 0, body: "{}" }));

  if (refreshCheck.status !== 200) return; // silent — no log (would flood on bad connection)

  const { pending } = JSON.parse(refreshCheck.body);
  if (!pending) {
    // No refresh requested — exit immediately, MySQL untouched
    return;
  }

  log(`=== Refresh requested — Mwalimu Sync Agent v${AGENT_VERSION} ===`);

  const today = kenyanDate();
  const cp    = loadCheckpoint();
  const nowMs = Date.now();

  // ── Phase 1: read from MySQL, close before uploads ────────────
  // buildProducts and buildMetrics use SEPARATE connections so that a
  // timed-out stran query (which can corrupt the connection object) does
  // not cascade and prevent metrics from being pushed.
  const productSyncDue = cp.date !== today || nowMs - (cp.lastProductSync || 0) > 4 * 60 * 60 * 1000;

  let productsData = null;
  let costMap      = cp.costMap || null;

  if (productSyncDue) {
    const conn1 = await openConn().catch(() => null);
    if (conn1) {
      const result = await buildProducts(conn1).catch(e => { log("Products build error: " + e.message); return null; });
      if (result) { productsData = result.products; costMap = result.costMap; }
      conn1.end();
    }
  }

  // Fresh connection for metrics — isolated from any buildProducts failure
  let metricsData = null;
  const conn1b = await openConn().catch(e => { log("MySQL connect failed: " + e.message); return null; });
  if (conn1b) {
    log("Connected to MySQL on server-pc.");
    metricsData = await buildMetrics(conn1b, today, costMap)
      .catch(e => { log("Metrics build error: " + e.message); return null; });
    conn1b.end();
  }

  // ── Phase 2: push to server ────────────────────────────────────
  let token;
  try { token = await getSyncToken(); } catch (e) { log("Auth failed: " + e.message); }

  let metricsPushed = false;
  if (metricsData) {
    metricsData.agentVersion = AGENT_VERSION;
    metricsPushed = await pushMetrics(metricsData)
      .catch(e => { log("Metrics push error: " + e.message); return false; });
  }

  if (productsData) {
    await syncProducts(productsData).catch(e => log("Products push error: " + e.message));
  }

  // ── Phase 3: write-back (pending changes + web sales) ─────────
  if (token) {
    const conn2 = await openConn().catch(e => { log("MySQL reconnect failed: " + e.message); return null; });
    if (conn2) {
      await applyPendingChanges(conn2, token).catch(e => log("PendingChanges error: " + e.message));
      await writeBackSales(conn2, token).catch(e => log("Writeback error: " + e.message));
      conn2.end();
    }
  }

  saveCheckpoint({
    txCount:         metricsPushed ? 0 : cp.txCount, // reset so next refresh always pushes
    date:            metricsPushed ? today : cp.date,
    lastProductSync: productSyncDue ? nowMs : (cp.lastProductSync || 0),
    costMap:         costMap || cp.costMap || null,
  });
  log("=== Sync complete ===");
}

// After every sync attempt (success or failure), forward the log to the
// server so it appears in PM2 logs and can be read remotely for diagnostics.
async function forwardLog() {
  if (!_logLines.length) return;
  try {
    await apiPost("/sync/bridge-log", { entries: _logLines.slice() }, SECRET);
  } catch {}
}

run()
  .then(forwardLog)
  .catch(err => { log("Fatal: " + err.message); forwardLog(); process.exit(1); });
