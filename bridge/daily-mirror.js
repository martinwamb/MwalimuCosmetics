/**
 * Mwalimu Cosmetics — Nightly MySQL → Hetzner Mirror
 *
 * Runs at 21:00 Kenyan time via Task Scheduler (MwalimuDailyMirror).
 *
 * What it does:
 *   1. Asks the server for the last successfully mirrored date.
 *   2. Syncs up to MAX_DAYS_PER_RUN days of MySQL data into PostgreSQL
 *      mirror tables on Hetzner, starting the day after the watermark.
 *   3. Updates the watermark only after a full batch completes, so if
 *      the PC shuts down mid-run the next night resumes automatically.
 *
 * Tables mirrored (date-partitioned):
 *   pos_header, pos_details, pos_payment_details, stran, grn, grn_d
 *
 * Reference tables (full replace each run):
 *   sitems — stock master with prices
 *
 * Impact on POS:
 *   All MySQL queries are read-only SELECT statements filtered to one
 *   day at a time. At 9 PM the shop is winding down; InnoDB SELECT
 *   queries do not block concurrent POS INSERT operations.
 */

const mysql = require("mysql");
const https = require("https");

const MIRROR_VERSION  = "1";          // informational only
const MAX_DAYS_PER_RUN = 60;          // days of history to sync per night
const BATCH_ROWS      = 500;          // rows per HTTP upload request

const MYSQL = {
  host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
  database: "mwalimuinvest", ssl: false, insecureAuth: true,
  connectTimeout: 10000,
};
const API    = "https://api.mwalimucosmetics.com";
const SECRET = "mwalimu-sync-secret";

// ── Helpers ───────────────────────────────────────────────────

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

function log(msg) { console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${msg}`); }

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r))
  );
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

function apiRequest(method, path, body, timeoutMs) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: "api.mwalimucosmetics.com",
      path, method,
      headers: {
        ...(data ? { "Content-Type": "application/json",
                     "Content-Length": Buffer.byteLength(data) } : {}),
        "x-sync-secret": SECRET,
      },
    }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => res({ status: r.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", rej);
    req.setTimeout(timeoutMs || 60000, () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

const apiGet  = path       => apiRequest("GET",  path, null,  30000);
const apiPost = (path, body) => apiRequest("POST", path, body, 180000); // 3-min for large payloads

// ── Upload helpers ────────────────────────────────────────────

async function uploadRows(table, date, rows) {
  if (rows.length === 0) {
    // Still notify server to clear stale data for this date
    const r = await apiPost("/sync/mirror/rows", { table, date, rows: [] });
    return r.status === 200;
  }

  // Send in batches of BATCH_ROWS to avoid huge single payloads
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const batch = rows.slice(i, i + BATCH_ROWS);
    const r = await apiPost("/sync/mirror/rows", { table, date, rows: batch });
    if (r.status !== 200) {
      log(`    [!] ${table} batch failed [${r.status}]: ${r.body.slice(0, 80)}`);
      return false;
    }
  }
  return true;
}

// ── Table definitions ─────────────────────────────────────────

const DATE_TABLES = [
  {
    name:   "pos_header",
    sql:    "SELECT * FROM pos_header WHERE DATE(trandate) = ?",
    params: d => [d],
  },
  {
    name:   "pos_details",
    sql:    `SELECT pd.*
             FROM   pos_details pd
             JOIN   pos_header ph ON pd.receiptno = ph.receiptno
             WHERE  DATE(ph.trandate) = ?`,
    params: d => [d],
  },
  {
    name:   "pos_payment_details",
    sql:    `SELECT ppd.*
             FROM   pos_payment_details ppd
             JOIN   pos_header ph ON ppd.receiptno = ph.receiptno
             WHERE  DATE(ph.trandate) = ?`,
    params: d => [d],
  },
  {
    name:   "stran",
    sql:    "SELECT * FROM stran WHERE DATE(stdate) = ?",
    params: d => [d],
  },
  {
    name:   "grn",
    sql:    "SELECT * FROM grn WHERE DATE(ddate) = ?",
    params: d => [d],
  },
  {
    name:   "grn_d",
    sql:    `SELECT gd.*
             FROM   grn_d gd
             JOIN   grn g ON gd.no = g.no
             WHERE  DATE(g.ddate) = ?`,
    params: d => [d],
  },
];

// ── Sync one calendar date ────────────────────────────────────

async function syncDate(conn, date) {
  let allOk = true;
  for (const t of DATE_TABLES) {
    try {
      const rows = await query(conn, t.sql, t.params(date));
      const clean = rows.map(cleanRow);
      const ok    = await uploadRows(t.name, date, clean);
      if (ok) {
        log(`    ${t.name}: ${clean.length} rows`);
      } else {
        log(`    [!] ${t.name}: upload failed`);
        allOk = false;
      }
    } catch (e) {
      log(`    [!] ${t.name} error: ${e.message}`);
      allOk = false;
    }
  }
  return allOk;
}

// ── Sync reference data (no date dimension) ───────────────────

async function syncReferenceData(conn) {
  log("  Syncing reference table: sitems…");
  try {
    const rows  = await query(conn, "SELECT * FROM sitems", []);
    const clean = rows.map(cleanRow);
    const r     = await apiPost("/sync/mirror/reference", { table: "sitems", rows: clean });
    if (r.status === 200) {
      const p = JSON.parse(r.body);
      log(`    sitems: ${p.rows} rows`);
    } else {
      log(`    [!] sitems failed [${r.status}]`);
    }
  } catch (e) {
    // sitems may not exist on all installations — non-fatal
    log(`    sitems skipped: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────

async function run() {
  log(`=== Mwalimu Daily Mirror v${MIRROR_VERSION} starting ===`);

  // 1. Get current watermark from server
  let statusRes;
  try {
    statusRes = await apiGet("/sync/mirror/status");
  } catch (e) {
    log("Cannot reach server: " + e.message + ". Aborting.");
    return;
  }
  if (statusRes.status !== 200) {
    log("Server returned " + statusRes.status + ". Aborting.");
    return;
  }

  const { lastDate } = JSON.parse(statusRes.body);
  const today     = kenyanDate();
  const yesterday = addDays(today, -1); // don't mirror today (data still changing)

  // 2. Determine start date
  let startDate;
  if (lastDate) {
    startDate = addDays(lastDate, 1);
    log(`Resuming from ${startDate} (last mirrored: ${lastDate})`);
  } else {
    // First ever run: find earliest transaction date in MySQL
    log("First run — finding earliest transaction date in MySQL…");
    let conn0;
    try {
      conn0 = await new Promise((res, rej) => {
        const c = mysql.createConnection(MYSQL);
        c.connect(e => e ? rej(e) : res(c));
      });
      const [row] = await query(conn0,
        "SELECT DATE(MIN(trandate)) AS earliest FROM pos_header WHERE trandate IS NOT NULL", []);
      startDate = row?.earliest
        ? new Date(row.earliest).toISOString().slice(0, 10)
        : addDays(today, -365);
      conn0.end();
    } catch (e) {
      if (conn0) try { conn0.end(); } catch {}
      startDate = addDays(today, -365);
      log("Could not determine earliest date, defaulting to 1 year back.");
    }
    log(`Historical mirror will start from ${startDate}`);
  }

  if (startDate > yesterday) {
    log("Mirror is fully up to date. Nothing to do.");
    return;
  }

  // 3. Slice to MAX_DAYS_PER_RUN
  const allPending   = getDatesRange(startDate, yesterday);
  const datesToSync  = allPending.slice(0, MAX_DAYS_PER_RUN);
  const stillPending = allPending.length - datesToSync.length;

  log(`Syncing ${datesToSync.length} days: ${datesToSync[0]} → ${datesToSync[datesToSync.length - 1]}`);
  if (stillPending > 0)
    log(`(${stillPending} more days will be synced in future nightly runs)`);

  // 4. Connect to MySQL
  let conn;
  try {
    conn = await new Promise((res, rej) => {
      const c = mysql.createConnection(MYSQL);
      c.connect(e => e ? rej(e) : res(c));
    });
    log("Connected to MySQL.");
  } catch (e) {
    log("MySQL connection failed: " + e.message + ". Aborting.");
    return;
  }

  // 5. Sync reference tables once per run
  await syncReferenceData(conn);

  // 6. Sync transactional data day by day
  let lastSuccessful = lastDate; // keep track for watermark update
  for (let i = 0; i < datesToSync.length; i++) {
    const date = datesToSync[i];
    log(`  [${i + 1}/${datesToSync.length}] ${date}`);
    const ok = await syncDate(conn, date);
    if (ok) {
      lastSuccessful = date;
    } else {
      // Partial failure on this date — stop here so watermark stays safe.
      // Next night will retry from this date.
      log(`  Stopping at ${date} due to errors. Will retry tomorrow.`);
      break;
    }
  }

  conn.end();

  // 7. Advance watermark to last fully successful date
  if (lastSuccessful && lastSuccessful !== lastDate) {
    const r = await apiPost("/sync/mirror/status", { lastDate: lastSuccessful });
    if (r.status === 200) {
      log(`Watermark advanced to ${lastSuccessful}.`);
    } else {
      log(`[!] Could not save watermark: ${r.body.slice(0, 80)}`);
    }
  }

  if (stillPending > 0 && lastSuccessful === datesToSync[datesToSync.length - 1]) {
    log(`${stillPending} days still pending — will continue tomorrow night.`);
  }

  log("=== Mirror complete ===");
}

run().catch(err => { log("Fatal: " + err.message); process.exit(1); });
