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
 *   node schema-probe.js --only engines,orphans     capture just those
 *   node schema-probe.js --residual-days 730        widen the GL scan
 *
 * The GL residual scan aggregates journal_transactions and is the one
 * genuinely expensive query here, so it defaults to 60 days. That is plenty
 * to establish whether residuals occur at all. Widen it after hours, not
 * while the shop is trading on a server this small.
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

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// --only lets a failed or slow run be retried in pieces rather than whole.
const ONLY = (() => {
  const raw = argValue("--only", null);
  return raw ? new Set(raw.split(",").map(s => s.trim()).filter(Boolean)) : null;
})();
const RESIDUAL_DAYS = Number(argValue("--residual-days", 60));

// Milliseconds to wait between statements. This server also runs the tills
// and cannot be worked on out of hours, because everything is powered down
// when the shop closes. So diagnostics run while people are selling, and the
// only responsible way to do that is slowly, one statement at a time.
const PACE_MS = Number(argValue("--pace", 3000));

// How far back the orphan census looks. Unbounded LEFT JOINs across the full
// history of pos_details are exactly the kind of query that makes a till
// hesitate; a recent window answers the question just as well.
const ORPHAN_DAYS = Number(argValue("--orphan-days", 90));

const wanted = (section) => !ONLY || ONLY.has(section);

const pause = (ms) => new Promise(r => setTimeout(r, ms));

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
  if (!wanted(name)) { log(`  skipped ${name} (not in --only)`); return; }

  // Never publish findings taken from a test database into the shared folder:
  // zeros from an empty fixture look exactly like a clean bill of health from
  // production, and there would be no way to tell them apart afterwards.
  const isTestDb = /test/i.test(String(MYSQL_CONFIG.database || ""));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(rows, null, 2));
  log(`  saved ${name}.json (${rows.length} rows)`);

  if (isTestDb) {
    log(`  not shipping ${name} — source is a test database (${MYSQL_CONFIG.database})`);
    return;
  }

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
  let vars = [];
  if (wanted("vars")) {
    // @@storage_engine exists on the shop's 5.1 but was removed by 5.7, and
    // @@old_passwords likewise varies. Read the portable ones first so a
    // missing variable cannot abort the whole probe, then try the rest.
    vars = await query(conn,
      `SELECT @@version AS version, @@sql_mode AS sql_mode,
              DATABASE() AS db, NOW() AS server_time`);
    for (const [alias, variable] of [["default_engine", "@@storage_engine"],
                                     ["default_engine", "@@default_storage_engine"],
                                     ["old_passwords",  "@@old_passwords"]]) {
      if (vars[0][alias] !== undefined) continue;
      try {
        const r = await query(conn, `SELECT ${variable} AS v`);
        vars[0][alias] = r[0].v;
      } catch { /* not present on this server version */ }
    }
    await emit("vars", vars);
    log(`  MySQL ${vars[0].version}, sql_mode='${vars[0].sql_mode}'`);
  }

  // ── Table list and engines ──────────────────────────────────
  // SHOW TABLE STATUS makes InnoDB gather per-table statistics, which across
  // 428 tables is not cheap. Only run it when something actually needs it,
  // and prefer information_schema.TABLES when only the names are wanted.
  let status = [];
  if (wanted("engines")) {
    status = await query(conn, `SHOW TABLE STATUS`);
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
  }

  // ── Full schema ─────────────────────────────────────────────
  let tables = [];
  if (wanted("schema")) {
    tables = status.length
      ? status.map(r => r.Name)
      : (await query(conn,
          `SELECT TABLE_NAME AS name FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`)).map(r => r.name);
  }
  if (tables.length) log(`Capturing CREATE TABLE for ${tables.length} tables…`);
  const schema = [];
  // 428 statements back to back is what made the earlier runs noticeable at
  // the counter. A short breath between them costs minutes we can afford.
  const schemaPace = Math.min(PACE_MS, 250);
  for (const t of tables) {
    if (schema.length) await pause(schemaPace);
    try {
      const r = await query(conn, `SHOW CREATE TABLE \`${t}\``);
      schema.push({ table: t, ddl: r[0]["Create Table"] || r[0]["Create View"] || null });
    } catch (e) {
      schema.push({ table: t, ddl: null, error: e.message });
    }
  }
  await emit("schema", schema);

  // ── Stored routines (the irreplaceable part) ────────────────
  const routineList = wanted("routines") ? await query(conn,
    `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
       FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = DATABASE()
      ORDER BY ROUTINE_TYPE, ROUTINE_NAME`) : [];
  if (routineList.length) log(`Capturing ${routineList.length} stored routines…`);

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
  if (routineList.length) {
    if (missing.length) log(`  *** WARNING: expected routines not captured: ${missing.join(", ")}`);
    else                log(`  all ${CRITICAL.length} critical routines captured`);
  }

  // ── Rounding residual probe ─────────────────────────────────
  // Per trancode the GL must net to zero. Anything else means the legacy app
  // is already leaving residuals, which we must consciously decide to either
  // replicate or correct — not discover months later in a trial balance.
  if (wanted("gl_residuals")) {
  log(`Probing GL balance residuals (last ${RESIDUAL_DAYS} days)…`);
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
          WHERE jtdate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          GROUP BY trancode, trantype
       ) t
      GROUP BY trantype
      ORDER BY unbalanced DESC`, [RESIDUAL_DAYS]);
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
      LIMIT 25`, [RESIDUAL_DAYS]);
  await emit("gl_residual_samples", samples);
  }

  // ── Orphan detector ─────────────────────────────────────────
  // Legacy writes pos_* outside its transaction, so pre-existing damage is
  // likely. Sizing it now stops it being blamed on the new app later.
  if (wanted("orphans")) {
  log(`Counting orphan rows over the last ${ORPHAN_DAYS} days, ${PACE_MS}ms apart…`);
  const orphans = [];

  // Each check is anchored on pos_header and bounded by date, so the join
  // drives off a recent slice rather than the whole history.
  const checks = [
    ["headers_without_details",
     `SELECT COUNT(*) AS n FROM pos_header h
        LEFT JOIN pos_details d ON d.receiptno = h.receiptno
       WHERE h.trandate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND h.receiptno <> 'AUTO' AND d.receiptno IS NULL`],
    ["posted_headers_without_payment",
     `SELECT COUNT(*) AS n FROM pos_header h
        LEFT JOIN pos_payment_details p ON p.receiptno = h.receiptno
       WHERE h.trandate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND h.receiptno <> 'AUTO' AND h.posted = 1 AND p.receiptno IS NULL`],
    ["unposted_headers",
     `SELECT COUNT(*) AS n FROM pos_header h
       WHERE h.trandate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND h.receiptno <> 'AUTO' AND h.posted = 0`],
    ["headers_without_stock_movement",
     `SELECT COUNT(*) AS n FROM pos_header h
        LEFT JOIN stran s ON s.trancode = h.receiptno
       WHERE h.trandate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND h.receiptno <> 'AUTO' AND h.posted = 1 AND s.trancode IS NULL`],
  ];

  for (const [name, sql] of checks) {
    await pause(PACE_MS);
    try {
      const started = Date.now();
      const r = await query(conn, sql, [ORPHAN_DAYS]);
      const ms = Date.now() - started;
      orphans.push({ check: name, count: r[0].n, ms, days: ORPHAN_DAYS });
      log(`  ${name}: ${r[0].n} (${ms}ms)`);

      // If a single count is already labouring, stop rather than run three
      // more like it. Better an incomplete census than a slow till.
      if (ms > 15000) {
        log(`  *** ${name} took ${ms}ms — stopping the census early to stay out of the way.`);
        break;
      }
    } catch (e) {
      orphans.push({ check: name, count: null, error: e.message });
      log(`  ${name}: failed — ${e.message}`);
    }
  }
  await emit("orphans", orphans);
  }

  conn.end();
  log(`=== Probe complete — output in ${OUT_DIR} ===`);
}

run().catch(err => { log("Fatal: " + err.message); process.exit(1); });
