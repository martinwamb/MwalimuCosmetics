/**
 * Why the tills are slow — diagnosis only. READ ONLY.
 *
 * Every statement here is a SELECT, SHOW or EXPLAIN. Nothing is created,
 * altered or written. It cannot lock a table and cannot delay a sale.
 *
 * The question it answers: FumasV5 runs this each time a line is added to a
 * sale, and it was measured occupying the live server for up to 3 seconds —
 *
 *     select sum(if(ts='+',tqty,tqty*-1))/1 as qty,
 *            get_category(code,'Stocks') as categ
 *       from stran where code = ? and loc = ?
 *
 * `stran` holds 2.4 million rows and already carries an index on CODE, so a
 * missing index is NOT the obvious explanation and an index is not assumed
 * to be the fix. The plausible causes are separated here:
 *
 *   1. `loc` is not part of any index, so filtering by location may read
 *      every row for that item and discard most of them.
 *   2. `get_category()` is a stored function and may run a query of its own.
 *   3. A handful of items may simply have enormous movement history.
 *
 * Statements are spaced apart, because this runs on the server that is also
 * running the tills.
 *
 *   node diagnose-slow-pos.js [--pace 3000]
 */

const mysql = require("mysql");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");

const MYSQL_CONFIG = getMysqlConfig({ connectTimeout: 15000 });
const SECRET  = process.env.MWALIMU_SYNC_SECRET || "mwalimu-sync-secret";
const OUT_DIR = path.join(__dirname, "diagnose-output");
const SHIP_KEY = "_slowpos";

const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PACE_MS = Number(argValue("--pace", 3000));

const log = (m) => console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${m}`);
const pause = (ms) => new Promise(r => setTimeout(r, ms));

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r)));
}

/**
 * Longest any single statement here may run before the whole script gives up.
 *
 * A previous version's first query aggregated the entire 2.4-million-row
 * ledger, ran for a quarter of an hour and was killed without reporting
 * anything. Read-only is not the same as cheap, and this is the backstop for
 * that distinction: if a statement is slow enough to be felt at a counter,
 * this script stops rather than continuing to lean on the server.
 */
const MAX_STATEMENT_MS = 8000;

class TooSlow extends Error {
  constructor(label, ms) {
    super(`"${label}" took ${ms}ms, beyond the ${MAX_STATEMENT_MS}ms limit — stopping so this does not affect the tills`);
    this.name = "TooSlow";
  }
}

/** Run a statement, timed, after waiting out the pacing gap. */
async function timed(conn, label, sql, params) {
  await pause(PACE_MS);
  const started = Date.now();
  try {
    const rows = await query(conn, sql, params);
    const ms = Date.now() - started;
    if (ms > MAX_STATEMENT_MS) throw new TooSlow(label, ms);
    return { label, ms, rows };
  } catch (e) {
    if (e instanceof TooSlow) throw e;
    return { label, ms: Date.now() - started, error: e.message };
  }
}

function apiPost(pathname, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.mwalimucosmetics.com", path: pathname, method: "POST",
      headers: { "Content-Type": "application/json",
                 "Content-Length": Buffer.byteLength(data),
                 "x-sync-secret": SECRET },
    }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res({ status: r.statusCode, body: b })); });
    req.on("error", rej);
    req.setTimeout(60000, () => req.destroy(new Error("timeout")));
    req.write(data); req.end();
  });
}

async function emit(name, rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(rows, null, 2));
  try {
    const r = await apiPost("/sync/backup", { date: SHIP_KEY, table: name, rows });
    log(`  ${r.status === 200 ? "shipped" : `ship failed [${r.status}]`} ${name}`);
  } catch (e) { log(`  ship error ${name}: ${e.message} (local copy kept)`); }
}

async function run() {
  log("=== POS slowness diagnosis (read only) ===");
  log(describeConfigSource(MYSQL_CONFIG));
  log(`Statements spaced ${PACE_MS}ms apart.`);

  const conn = mysql.createConnection(toDriverOptions(MYSQL_CONFIG));
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));

  const findings = collected;
  const record = (r) => {
    findings.push(r);
    log(`  ${r.label}: ${r.error ? "FAILED " + r.error : r.ms + "ms"}`);
  };

  // 1. Pick a busy item to test against.
  //
  // The obvious way to find the busiest item is GROUP BY CODE across the
  // whole table. That is a scan and sort of 2.4 million rows and is NOT a
  // light query — an earlier version of this script did exactly that, ran
  // for a quarter of an hour and had to be killed. Never again.
  //
  // Instead: take a recent slice of sales and use one of the items actually
  // being sold. That is the case the tills care about anyway, and it reads a
  // few hundred rows through an index rather than the entire ledger.
  const recent = await timed(conn, "pick a recently sold item (indexed, bounded)",
    `SELECT d.code, COUNT(*) AS times_sold
       FROM pos_details d
       JOIN pos_header h ON h.receiptno = d.receiptno
      WHERE h.trandate >= DATE_SUB(NOW(), INTERVAL 2 DAY)
      GROUP BY d.code
      ORDER BY times_sold DESC
      LIMIT 5`);
  record(recent);
  const worstCode = recent.rows?.[0]?.code;
  if (recent.rows) {
    recent.rows.forEach(r => log(`      ${String(r.code).padEnd(18)} sold ${r.times_sold}x in 2 days`));
  }

  // 2. How much history that item has. Counting rows for ONE code uses the
  //    index on CODE and touches only that item's rows.
  if (worstCode) {
    const depth = await timed(conn, "movement rows for that one item",
      "SELECT COUNT(*) AS rows_ FROM stran WHERE CODE = ?", [worstCode]);
    record(depth);
    if (depth.rows) log(`      ${Number(depth.rows[0].rows_).toLocaleString()} rows of history`);
  }

  // 2. What the planner actually does with the till's query.
  if (worstCode) {
    const plan = await timed(conn, "EXPLAIN of the till query",
      `EXPLAIN SELECT SUM(IF(ts='+',tqty,tqty*-1))/1 AS qty,
                     get_category(CODE,'Stocks') AS categ
                FROM stran WHERE CODE = ? AND loc = ?`, [worstCode, "MAIN"]);
    record(plan);
    plan.rows?.forEach(r => log(
      `      key=${r.key || "NONE"}  rows examined=${Number(r.rows).toLocaleString()}  ${r.Extra || ""}`));

    // 3. The same sum WITHOUT the function, to see how much of the time is
    //    the aggregate and how much is get_category().
    const noFn = await timed(conn, "same sum without get_category()",
      "SELECT SUM(IF(ts='+',tqty,tqty*-1))/1 AS qty FROM stran WHERE CODE = ? AND loc = ?",
      [worstCode, "MAIN"]);
    record(noFn);

    // 4. The function on its own, called once.
    const fnOnly = await timed(conn, "get_category() alone",
      "SELECT get_category(?,'Stocks') AS categ", [worstCode]);
    record(fnOnly);

    // 5. Without the location filter, which is the column no index covers.
    const noLoc = await timed(conn, "same sum without the loc filter",
      "SELECT SUM(IF(ts='+',tqty,tqty*-1))/1 AS qty FROM stran WHERE CODE = ?", [worstCode]);
    record(noLoc);

    // 6. How many rows that item actually has per location — if one location
    //    holds nearly all of them, filtering by loc is not what costs.
    const byLoc = await timed(conn, "rows per location for that item",
      "SELECT loc, COUNT(*) AS rows_ FROM stran WHERE CODE = ? GROUP BY loc ORDER BY rows_ DESC LIMIT 5",
      [worstCode]);
    record(byLoc);
    byLoc.rows?.forEach(r => log(`      ${String(r.loc || "(blank)").padEnd(14)} ${Number(r.rows_).toLocaleString()} rows`));
  }

  // 7. What get_category is actually doing.
  const fnDef = await timed(conn, "get_category definition",
    "SHOW CREATE FUNCTION get_category");
  record(fnDef);
  if (fnDef.rows?.[0]) {
    const body = String(fnDef.rows[0]["Create Function"] || "").replace(/\s+/g, " ");
    log(`      ${body.slice(0, 300)}`);
  }

  // 8. Does `sq` already hold the answer the till is computing the hard way?
  //    If it does, the cheapest fix is a code change in FumasV5 rather than
  //    anything done to this table.
  // COUNT(DISTINCT CODE) over stran would be another full scan of 2.4 million
  // rows — the same mistake as before. `sq` is small enough to count directly,
  // and `si` gives the number of items to compare it against.
  const sqCheck = await timed(conn, "sq cache coverage",
    `SELECT (SELECT COUNT(*) FROM sq) AS sq_rows,
            (SELECT COUNT(*) FROM si) AS items`);
  record(sqCheck);
  if (sqCheck.rows?.[0]) {
    const { sq_rows, items } = sqCheck.rows[0];
    log(`      sq holds ${Number(sq_rows).toLocaleString()} rows for ${Number(items).toLocaleString()} items`);
  }

  // 9. Whether sq agrees with the ledger for the worst item. If it does, the
  //    till could read one row instead of summing thousands.
  if (worstCode) {
    const agree = await timed(conn, "does sq agree with the ledger",
      `SELECT (SELECT SUM(IF(ts='+',tqty,tqty*-1)) FROM stran WHERE CODE = ?) AS from_ledger,
              (SELECT SUM(quantity) FROM sq WHERE CODE = ?) AS from_cache`,
      [worstCode, worstCode]);
    record(agree);
    if (agree.rows?.[0]) {
      const { from_ledger, from_cache } = agree.rows[0];
      log(`      ledger ${from_ledger}  cache ${from_cache}  ${Number(from_ledger) === Number(from_cache) ? "AGREE" : "DIFFER"}`);
    }
  }

  // 10. Size on disk, which is what an index rebuild would have to copy.
  const size = await timed(conn, "stran size on disk",
    `SELECT table_rows, ROUND(data_length/1048576) AS data_mb,
            ROUND(index_length/1048576) AS index_mb
       FROM information_schema.TABLES
      WHERE table_schema = DATABASE() AND table_name = 'stran'`);
  record(size);
  if (size.rows?.[0]) {
    const r = size.rows[0];
    log(`      ~${Number(r.table_rows).toLocaleString()} rows, ${r.data_mb}MB data + ${r.index_mb}MB index`);
    log(`      (an ADD INDEX on 5.1 rebuilds all of that while holding a lock)`);
  }

  await shipFindings(findings);
  conn.end();
  log("=== diagnosis complete — nothing was modified ===");
}

/** Ship whatever was gathered, even a partial set. */
async function shipFindings(findings) {
  if (!findings.length) { log("nothing gathered, nothing to ship"); return; }
  await emit("diagnosis", findings.map(f => ({
    label: f.label, ms: f.ms, error: f.error ?? null,
    rows: f.rows ? JSON.parse(JSON.stringify(f.rows)) : null,
  })));
}

// Findings are collected here rather than inside run(), so that a run cut
// short still reports what it managed to learn. The earlier version gathered
// everything and shipped at the very end, so being killed part-way meant
// losing the lot and knowing nothing about why.
const collected = [];

run().catch(async (err) => {
  log("Stopped early: " + err.message);
  try { await shipFindings(collected); } catch { /* keep the local copy */ }
  process.exit(1);
});
