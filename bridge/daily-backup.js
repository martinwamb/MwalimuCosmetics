/**
 * Mwalimu Cosmetics — Daily MySQL Backup
 *
 * Ships today's completed transactions from MySQL to Hetzner for historical
 * querying. Run once per day (e.g. via Task Scheduler at 11 PM).
 *
 * Tables backed up:
 *   pos_header          — receipt headers (one row per transaction)
 *   pos_details         — line items (products sold per receipt)
 *   pos_payment_details — payment method breakdown per receipt
 *   stran               — stock movement ledger (today's entries)
 *   grn                 — goods received note headers (for purchases in history)
 *
 * The server stores each table as a JSON file under /backups/{date}/{table}.json.
 * No size limit: all rows for the given date are included.
 */

const mysql = require("mysql");
const https = require("https");

const MYSQL = {
  host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
  database: "mwalimuinvest", ssl: false, insecureAuth: true, connectTimeout: 8000,
};
const SECRET = "mwalimu-sync-secret";

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function log(msg) { console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${msg}`); }

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r))
  );
}

function apiPost(path, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: "api.mwalimucosmetics.com",
      path, method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-sync-secret":  SECRET,
      },
    }, r => {
      let b = "";
      r.on("data", c => b += c);
      r.on("end", () => res({ status: r.statusCode, body: b }));
    });
    req.on("error", rej);
    req.setTimeout(60000, () => req.destroy(new Error("timeout")));
    req.write(data); req.end();
  });
}

async function backupTable(conn, table, date, sql, params) {
  log(`Backing up ${table} for ${date}…`);
  const rows = await query(conn, sql, params);

  // Convert any non-serialisable types (Decimal, Buffer, Date) to plain values
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

  const r = await apiPost("/sync/backup", { date, table, rows: clean });
  if (r.status === 200) {
    const parsed = JSON.parse(r.body);
    log(`  ${table}: ${parsed.rows} rows backed up.`);
  } else {
    log(`  ${table} backup failed [${r.status}]: ${r.body}`);
  }
}

async function run() {
  const today = kenyanDate();
  log(`=== Daily backup starting for ${today} ===`);

  const conn = mysql.createConnection(MYSQL);
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));
  log("Connected to MySQL.");

  await backupTable(conn, "pos_header", today,
    `SELECT * FROM pos_header WHERE DATE(trandate) = ?`, [today]);

  await backupTable(conn, "pos_details", today,
    `SELECT pd.* FROM pos_details pd
     JOIN pos_header ph ON pd.receiptno = ph.receiptno
     WHERE DATE(ph.trandate) = ?`, [today]);

  await backupTable(conn, "pos_payment_details", today,
    `SELECT ppd.* FROM pos_payment_details ppd
     JOIN pos_header ph ON ppd.receiptno = ph.receiptno
     WHERE DATE(ph.trandate) = ?`, [today]);

  await backupTable(conn, "stran", today,
    `SELECT * FROM stran WHERE DATE(stdate) = ?`, [today]);

  await backupTable(conn, "grn", today,
    `SELECT * FROM grn WHERE DATE(ddate) = ?`, [today]);

  conn.end();
  log("=== Daily backup complete ===");
}

run().catch(err => { log("Fatal: " + err.message); process.exit(1); });
