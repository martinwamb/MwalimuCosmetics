/**
 * Nightly draft census. READ ONLY.
 *
 * Two PCs are reported to lose drafts when they are switched off. Checked
 * against the live database, that is not what the records show: every
 * unposted receipt carries a real number, and 108 of them are older than
 * today and still present. So drafts are not being deleted, and the problem
 * is more likely that someone cannot find or resume one than that it is gone.
 *
 * Guessing further would be a third guess after two wrong ones, so this
 * measures instead. It records every draft each evening. Comparing one night
 * with the next answers the question outright:
 *
 *   - a draft present yesterday and missing today, with no matching posted
 *     receipt, really has been deleted;
 *   - a draft that turned into a posted receipt was simply completed;
 *   - a draft that persists for days was never lost, only never found.
 *
 * It also groups by till and by cashier, which is what should reveal the two
 * machines in question.
 *
 * Every statement is a SELECT, bounded and indexed. Nothing is written to
 * the shop's database.
 *
 *   node check-drafts.js [--days 30] [--pace 2000]
 */

const mysql = require("mysql");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");

const MYSQL_CONFIG = getMysqlConfig({ connectTimeout: 15000 });
const SECRET   = process.env.MWALIMU_SYNC_SECRET || "mwalimu-sync-secret";
const OUT_DIR  = path.join(__dirname, "drafts-output");
const SHIP_KEY = "_drafts";

const argValue = (f, d) => {
  const i = process.argv.indexOf(f);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DAYS    = Number(argValue("--days", 30));
const PACE_MS = Number(argValue("--pace", 2000));

/** No statement here should be slow; if one is, stop rather than lean on the server. */
const MAX_STATEMENT_MS = 8000;

const log = (m) => console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${m}`);
const pause = (ms) => new Promise(r => setTimeout(r, ms));

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r)));
}

async function timed(conn, label, sql, params) {
  await pause(PACE_MS);
  const started = Date.now();
  const rows = await query(conn, sql, params);
  const ms = Date.now() - started;
  if (ms > MAX_STATEMENT_MS) {
    throw new Error(`"${label}" took ${ms}ms — stopping so this cannot affect the tills`);
  }
  log(`  ${label}: ${rows.length} row(s), ${ms}ms`);
  return rows;
}

function apiPost(pathname, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.mwalimucosmetics.com", path: pathname, method: "POST",
      headers: { "Content-Type": "application/json",
                 "Content-Length": Buffer.byteLength(data),
                 "x-sync-secret": SECRET },
    }, r => { let b=""; r.on("data",c=>b+=c); r.on("end",()=>res({status:r.statusCode,body:b})); });
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
  } catch (e) { log(`  ship error: ${e.message} (local copy kept)`); }
}

async function run() {
  log("=== nightly draft census (read only) ===");
  log(describeConfigSource(MYSQL_CONFIG));

  const conn = mysql.createConnection(toDriverOptions(MYSQL_CONFIG));
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));

  // Every draft, individually, so tomorrow's run can be compared with tonight's.
  const drafts = await timed(conn, "drafts outstanding",
    `SELECT receiptno, staff, salesref, location, arname, amount,
            trandate, posdate, pos AS till
       FROM pos_header
      WHERE posted = 0 AND receiptno <> 'AUTO'
        AND trandate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY trandate DESC`, [DAYS]);

  // Which cashier, which till. This is what should single out the two PCs.
  const byWho = await timed(conn, "drafts by cashier and till",
    `SELECT COALESCE(NULLIF(salesref,''), staff) AS who,
            COALESCE(NULLIF(pos,''), '(not recorded)') AS till,
            COUNT(*) AS drafts, MIN(trandate) AS oldest, MAX(trandate) AS newest
       FROM pos_header
      WHERE posted = 0 AND receiptno <> 'AUTO'
        AND trandate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY who, till
      ORDER BY drafts DESC`, [DAYS]);
  byWho.forEach(r => log(
    `      ${String(r.who).padEnd(14)} ${String(r.till).padEnd(16)} ${String(r.drafts).padStart(4)} drafts`));

  // Anything still sitting as 'AUTO' is genuinely at risk: the POS screen
  // deletes those on every open, on every PC.
  const unnumbered = await timed(conn, "unnumbered scratch rows (at risk)",
    `SELECT COUNT(*) AS n FROM pos_header WHERE receiptno = 'AUTO'`);
  if (Number(unnumbered[0].n) > 0) {
    log(`      *** ${unnumbered[0].n} unnumbered row(s) present — these ARE wiped when any PC opens the POS screen`);
  }

  // A draft with no lines is one that was started and abandoned before
  // anything was scanned; worth telling apart from a real interrupted sale.
  const empty = await timed(conn, "drafts with no lines",
    `SELECT COUNT(*) AS n
       FROM pos_header h
       LEFT JOIN pos_details d ON d.receiptno = h.receiptno
      WHERE h.posted = 0 AND h.receiptno <> 'AUTO'
        AND h.trandate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND d.receiptno IS NULL`, [DAYS]);

  const summary = {
    takenAt: new Date().toISOString(),
    windowDays: DAYS,
    totalDrafts: drafts.length,
    unnumberedAtRisk: Number(unnumbered[0].n),
    draftsWithNoLines: Number(empty[0].n),
  };
  log("");
  log(`  ${summary.totalDrafts} drafts, ${summary.unnumberedAtRisk} unnumbered, ${summary.draftsWithNoLines} with no lines`);

  await emit("summary", [summary]);
  await emit("drafts", drafts.map(r => ({
    receiptno: String(r.receiptno), staff: String(r.staff ?? ""),
    salesref: String(r.salesref ?? ""), location: String(r.location ?? ""),
    customer: String(r.arname ?? ""), amount: String(r.amount ?? ""),
    trandate: String(r.trandate ?? ""), till: String(r.till ?? ""),
  })));
  await emit("by_cashier", byWho.map(r => ({
    who: String(r.who), till: String(r.till), drafts: Number(r.drafts),
    oldest: String(r.oldest ?? ""), newest: String(r.newest ?? ""),
  })));

  conn.end();
  log("=== census complete — nothing was modified ===");
}

run().catch(err => { log("Stopped: " + err.message); process.exit(1); });
