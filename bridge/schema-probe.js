/**
 * Mwalimu Cosmetics — Phase 0 Schema Probe (READ-ONLY)
 *
 * Captures the "ground truth" of the live MySQL 5.1.73 database so the new
 * desktop system can be built against real contracts instead of guesses.
 *
 * This script NEVER writes to MySQL. Every statement is SHOW / SELECT.
 *
 * What it captures:
 *   schema    — SHOW CREATE TABLE for every table
 *   routines  — SHOW CREATE PROCEDURE/FUNCTION for every stored routine.
 *               These exist ONLY inside the live MySQL instance; there is no
 *               copy in any source tree. do_stock_transactions is the sole
 *               path by which stock is ever written, so losing it would mean
 *               losing the ability to record stock movements at all.
 *   engines   — SHOW TABLE STATUS. If the ledger tables are MyISAM then
 *               BEGIN/COMMIT is silently a no-op and no amount of application
 *               code can make a sale atomic.
 *   vars      — @@version, @@sql_mode, @@storage_engine (test DB must match)
 *   rounding  — pos_header.amount is CEILING'd; if the GL legs are not, every
 *               receipt leaves a residual and the trial balance drifts. This
 *               measures whether that is already happening in production.
 *
 * Results are written locally AND shipped to the server, so the capture
 * survives even if this PC is the thing that dies.
 *
 * Usage (on the office PC, which can reach 10.10.10.4):
 *   node schema-probe.js
 */

const mysql = require("mysql");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");

const MYSQL_CONFIG = getMysqlConfig({ connectTimeout: 15000 });
const SECRET   = process.env.MWALIMU_SYNC_SECRET || "mwalimu-sync-secret";
const OUT_DIR  = path.join(__dirname, "schema-probe-output");
// Fixed folder name so re-runs overwrite rather than scatter across dates.
const SHIP_KEY = "_phase0";

function log(msg) { console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${msg}`); }

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r))
  );
}

function apiPost(pathname, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: "api.mwalimucosmetics.com",
      path: pathname, method: "POST",
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
    req.setTimeout(120000, () => req.destroy(new Error("timeout")));
    req.write(data); req.end();
  });
}

/** Persist locally, then ship. A failure to ship must not lose the capture. */
async function emit(name, rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(rows, null, 2));
  log(`  saved ${name}.json (${rows.length} rows)`);

  try {
    const r = await apiPost("/sync/backup", { date: SHIP_KEY, table: name, rows });
    if (r.status === 200) log(`  shipped ${name}`);
    else                  log(`  ship failed for ${name} [${r.status}]: ${r.body}`);
  } catch (e) {
    log(`  ship error for ${name}: ${e.message} (local copy kept)`);
  }
}

async function run() {
  log("=== Phase 0 schema probe starting (read-only) ===");
  log(describeConfigSource(MYSQL_CONFIG));

  const conn = mysql.createConnection(toDriverOptions(MYSQL_CONFIG));
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));
  log("Connected to MySQL.");

  // ── Server variables ────────────────────────────────────────
  // The local test instance must mirror sql_mode or tests pass while
  // production rejects the same statement (5.7 is far stricter than 5.1).
  const vars = await query(conn,
    `SELECT @@version AS version, @@sql_mode AS sql_mode,
            @@storage_engine AS default_engine, @@old_passwords AS old_passwords,
            DATABASE() AS db, NOW() AS server_time`);
  await emit("vars", vars);
  log(`  MySQL ${vars[0].version}, sql_mode='${vars[0].sql_mode}'`);

  // ── Table engines ───────────────────────────────────────────
  const status = await query(conn, `SHOW TABLE STATUS`);
  const engines = status.map(r => ({
    name: r.Name, engine: r.Engine, rows: r.Rows,
    dataLength: r.Data_length, collation: r.Collation,
  }));
  await emit("engines", engines);

  const LEDGER = ["pos_header", "pos_details", "pos_payment_details",
                  "journal_transactions", "creditors_transactions",
                  "stran", "nauto", "ap_prepayment", "accounts"];
  const nonInnodb = engines.filter(e =>
    LEDGER.includes(e.name) && String(e.engine).toLowerCase() !== "innodb");
  if (nonInnodb.length) {
    log(`  *** WARNING: these ledger tables are NOT InnoDB — transactions will NOT roll back:`);
    nonInnodb.forEach(e => log(`      ${e.name} = ${e.engine}`));
  } else {
    log(`  all ${LEDGER.length} ledger tables are InnoDB (transactions are real)`);
  }

  // ── Full schema ─────────────────────────────────────────────
  const tables = status.map(r => r.Name);
  log(`Capturing CREATE TABLE for ${tables.length} tables…`);
  const schema = [];
  for (const t of tables) {
    try {
      const r = await query(conn, `SHOW CREATE TABLE \`${t}\``);
      schema.push({ table: t, ddl: r[0]["Create Table"] || r[0]["Create View"] || null });
    } catch (e) {
      schema.push({ table: t, ddl: null, error: e.message });
    }
  }
  await emit("schema", schema);

  // ── Stored routines (the irreplaceable part) ────────────────
  const routineList = await query(conn,
    `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
       FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = DATABASE()
      ORDER BY ROUTINE_TYPE, ROUTINE_NAME`);
  log(`Capturing ${routineList.length} stored routines…`);

  const routines = [];
  for (const { name, type } of routineList) {
    const verb = type === "PROCEDURE" ? "PROCEDURE" : "FUNCTION";
    try {
      const r = await query(conn, `SHOW CREATE ${verb} \`${name}\``);
      routines.push({
        name, type,
        ddl: r[0][`Create ${verb === "PROCEDURE" ? "Procedure" : "Function"}`] || null,
      });
    } catch (e) {
      routines.push({ name, type, ddl: null, error: e.message });
    }
  }
  await emit("routines", routines);

  const CRITICAL = ["do_stock_transactions", "do_siserial_transactions",
                    "get_smallest_qty", "get_payref", "get_category", "get_average_cost"];
  const captured = new Set(routines.filter(r => r.ddl).map(r => r.name));
  const missing  = CRITICAL.filter(n => !captured.has(n));
  if (missing.length) log(`  *** WARNING: expected routines not captured: ${missing.join(", ")}`);
  else                log(`  all ${CRITICAL.length} critical routines captured`);

  // ── Rounding residual probe ─────────────────────────────────
  // Per trancode the GL must net to zero. Anything else means the legacy app
  // is already leaving residuals, which we must consciously decide to either
  // replicate or correct — not discover months later in a trial balance.
  log("Probing GL balance residuals (last 2 years)…");
  const residuals = await query(conn,
    `SELECT trantype,
            COUNT(*)                                            AS trancodes,
            SUM(ABS(net) > 0.005)                               AS unbalanced,
            MAX(ABS(net))                                       AS worst,
            SUM(net)                                            AS cumulative_drift
       FROM (
         SELECT trancode, trantype,
                SUM(IF(transign = '+', amount, -amount)) AS net
           FROM journal_transactions
          WHERE jtdate >= DATE_SUB(CURDATE(), INTERVAL 2 YEAR)
          GROUP BY trancode, trantype
       ) t
      GROUP BY trantype
      ORDER BY unbalanced DESC`);
  await emit("gl_residuals", residuals);
  residuals.forEach(r =>
    log(`  ${r.trantype}: ${r.unbalanced}/${r.trancodes} unbalanced, worst ${r.worst}, drift ${r.cumulative_drift}`));

  // A few worked examples make the pattern diagnosable rather than just visible.
  const samples = await query(conn,
    `SELECT trancode, trantype, SUM(IF(transign='+', amount, -amount)) AS net,
            MIN(jtdate) AS jtdate
       FROM journal_transactions
      WHERE trantype = 'POS' AND jtdate >= DATE_SUB(CURDATE(), INTERVAL 2 YEAR)
      GROUP BY trancode, trantype
     HAVING ABS(net) > 0.005
      ORDER BY jtdate DESC
      LIMIT 25`);
  await emit("gl_residual_samples", samples);

  // ── Orphan detector ─────────────────────────────────────────
  // Legacy writes pos_* outside its transaction, so pre-existing damage is
  // likely. Sizing it now stops it being blamed on the new app later.
  log("Counting pre-existing orphan rows…");
  const orphans = [];
  const checks = [
    ["details_without_header",
     `SELECT COUNT(*) AS n FROM pos_details d
        LEFT JOIN pos_header h ON h.receiptno = d.receiptno
       WHERE h.receiptno IS NULL`],
    ["headers_without_details",
     `SELECT COUNT(*) AS n FROM pos_header h
        LEFT JOIN pos_details d ON h.receiptno = d.receiptno
       WHERE d.receiptno IS NULL AND h.receiptno <> 'AUTO'`],
    ["posted_headers_without_payment",
     `SELECT COUNT(*) AS n FROM pos_header h
        LEFT JOIN pos_payment_details p ON h.receiptno = p.receiptno
       WHERE p.receiptno IS NULL AND h.posted = 1 AND h.receiptno <> 'AUTO'`],
    ["unposted_headers",
     `SELECT COUNT(*) AS n FROM pos_header WHERE posted = 0 AND receiptno <> 'AUTO'`],
  ];
  for (const [name, sql] of checks) {
    try {
      const r = await query(conn, sql);
      orphans.push({ check: name, count: r[0].n });
      log(`  ${name}: ${r[0].n}`);
    } catch (e) {
      orphans.push({ check: name, count: null, error: e.message });
    }
  }
  await emit("orphans", orphans);

  conn.end();
  log(`=== Probe complete — output in ${OUT_DIR} ===`);
}

run().catch(err => { log("Fatal: " + err.message); process.exit(1); });
