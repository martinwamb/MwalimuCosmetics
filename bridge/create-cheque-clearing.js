/**
 * Mwalimu Cosmetics — the cheque clearing register.
 *
 * One row per cheque, in either direction, carrying the one fact nothing in
 * FumasV5 records today: whether it actually went through the bank.
 *
 * Why a new table rather than a column on an existing one:
 *
 *   Incoming cheques already have somewhere to put this — ar_prepayment.banked
 *   and banked_accountcode/name — but outgoing ones have nothing, and splitting
 *   the two sides across different mechanisms would make the daily screen
 *   incoherent. cheque_entries looked like the outgoing home, but it is written
 *   by something outside this repository (nothing in the FumasV5 source or the
 *   web app touches it, yet it gained 654 rows this year), so adding a column
 *   there could break a writer we cannot see. A new table touches no existing
 *   writer at all.
 *
 * cheque_clearing is the source of truth. When an incoming cheque clears,
 * ar_prepayment.banked is set in the same transaction so FumasV5's own AR
 * screens agree with it.
 *
 * ── Where the backfill data comes from, and why ────────────────────────
 *
 * OUTGOING: ap_prepayment WHERE rtype='Q'. Not cheque_entries, despite that
 * being the obvious-looking "cheque diary": cheque_entries holds only 654 rows
 * against ap_prepayment's 6,415, and 5,869 AP cheques are missing from it. On
 * all 546 cheques present in both, cheque_entries.bdate equals
 * ap_prepayment.pdate exactly — so ap_prepayment.pdate IS the banking date and
 * the diary adds nothing. The 108 cheque_entries rows with no ap_prepayment
 * match are carried in separately so nothing is lost.
 *
 * Note ap_prepayment.bdate is NOT used: it differs from pdate on 4,652 of the
 * 6,415 cheques and its minimum is 2012-12-31, i.e. it is unmaintained.
 *
 * INCOMING: ar_prepayment WHERE rtype='Q', using bdate — which there IS
 * maintained and genuinely post-dates pdate in live data (CD61: taken 16 Oct,
 * banked 27 Oct). There are only 5 such rows, all from 2024; the incoming
 * pipeline effectively starts empty, which is the problem being fixed.
 *
 * ── Why old cheques are backfilled as CLEARED ──────────────────────────
 *
 * Marking 6,000 historical cheques PENDING would greet whoever logs in with
 * six thousand things to confirm — precisely the build-up this is meant to
 * prevent. Anything due before the cutoff (default: 7 days ago) is recorded as
 * CLEARED with staff='BACKFILL' and a remark saying it was assumed, never
 * verified against a statement. Nothing pretends to be a real reconciliation.
 *
 * Dry run by default. Pass --apply to write. --cutoff YYYY-MM-DD to move the
 * line between "assumed cleared" and "needs confirming".
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const cutoffArg = argValue("--cutoff");
if (cutoffArg && !/^\d{4}-\d{2}-\d{2}$/.test(cutoffArg)) {
  console.error("--cutoff must look like 2026-08-01");
  process.exit(1);
}

const DDL = `
CREATE TABLE IF NOT EXISTS cheque_clearing (
  id             int(11)       NOT NULL AUTO_INCREMENT,
  side           varchar(3)    NOT NULL,
  pno            varchar(30)   NOT NULL,
  cheque_no      varchar(50)   NOT NULL,
  account        varchar(50)   NOT NULL,
  due_date       date          NOT NULL,
  amount         decimal(22,2) NOT NULL DEFAULT '0.00',
  party_code     varchar(50)   NOT NULL DEFAULT '',
  party_name     varchar(100)  NOT NULL DEFAULT '',
  status         varchar(12)   NOT NULL DEFAULT 'PENDING',
  cleared_date   date                   DEFAULT NULL,
  statement_line int(11)                DEFAULT NULL,
  staff          varchar(30)   NOT NULL DEFAULT '',
  staffdate      datetime               DEFAULT NULL,
  remarks        varchar(200)  NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_cheque (side, pno, cheque_no),
  KEY idx_due (due_date, status),
  KEY idx_status (status, side)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

// status is a plain varchar rather than an ENUM: MySQL 5.1 ENUMs need an ALTER
// to add a value, and this list will grow.
const STATUSES = "PENDING | CLEARED | BOUNCED | REPRESENTED | CANCELLED";

const cfg = getMysqlConfig();
console.log(describeConfigSource(cfg));
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 60000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

// Dates are formatted in SQL rather than handed back as driver Date objects:
// the driver builds them in local time, which shifts every date by the UTC+3
// offset and makes "due today" read as yesterday.
const D = (col) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;

async function main() {
  const [{ cutoff }] = await q(
    cutoffArg
      ? "SELECT ? AS cutoff"
      : "SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '%Y-%m-%d') AS cutoff",
    cutoffArg ? [cutoffArg] : []);

  console.log(`Statuses: ${STATUSES}`);
  console.log(`Cutoff:   ${cutoff}  — due before this is backfilled CLEARED, on/after it PENDING\n`);

  // ── 1. The table ──────────────────────────────────────────────────
  const [existing] = await q(
    "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cheque_clearing'");
  if (existing.n) {
    const [{ rows }] = await q("SELECT COUNT(*) rows FROM cheque_clearing");
    console.log(`cheque_clearing already exists (${rows} rows) — table left alone`);
  } else {
    console.log("cheque_clearing: CREATE TABLE");
    if (APPLY) await q(DDL);
  }

  // ── 2. What the backfill would take ───────────────────────────────
  const outgoing = await q(
    `SELECT ${D("pdate")} due, COUNT(*) n, ROUND(SUM(amount)) amt,
            SUM(pdate < ?) past, SUM(pdate >= ?) ahead
       FROM ap_prepayment
      WHERE rtype = 'Q' AND cheque_no <> '' AND cheque_no IS NOT NULL AND pno IS NOT NULL
      LIMIT 1`, [cutoff, cutoff]);

  const [outTotals] = await q(
    `SELECT COUNT(*) n, SUM(pdate < ?) past, SUM(pdate >= ?) ahead, ROUND(SUM(amount)) amt
       FROM ap_prepayment
      WHERE rtype = 'Q' AND cheque_no <> '' AND cheque_no IS NOT NULL AND pno IS NOT NULL`,
    [cutoff, cutoff]);

  const [inTotals] = await q(
    `SELECT COUNT(*) n, SUM(bdate < ?) past, SUM(bdate >= ?) ahead, ROUND(SUM(amount)) amt
       FROM ar_prepayment
      WHERE rtype = 'Q' AND cheque_no <> '' AND cheque_no IS NOT NULL AND pno IS NOT NULL`,
    [cutoff, cutoff]);

  const [orphanTotals] = await q(
    `SELECT COUNT(*) n, ROUND(SUM(ce.amount)) amt
       FROM cheque_entries ce
       LEFT JOIN ap_prepayment ap ON ap.cheque_no = ce.chequeno AND ap.pno = ce.code
      WHERE ap.pid IS NULL AND ce.chequeno <> '' AND ce.chequeno IS NOT NULL`);

  console.table([
    { source: "ap_prepayment (OUT)",  cheques: outTotals.n,    assumed_cleared: outTotals.past, to_confirm: outTotals.ahead, value: outTotals.amt },
    { source: "ar_prepayment (IN)",   cheques: inTotals.n,     assumed_cleared: inTotals.past,  to_confirm: inTotals.ahead,  value: inTotals.amt },
    { source: "cheque_entries orphans", cheques: orphanTotals.n, assumed_cleared: "—",          to_confirm: "—",             value: orphanTotals.amt },
  ]);
  void outgoing;

  // ── 3. Backfill ───────────────────────────────────────────────────
  // INSERT IGNORE against the unique key, so re-running is harmless and the
  // cheque_entries pass cannot duplicate anything ap_prepayment already gave.
  const backfillRemark = "Backfilled at go-live; assumed cleared, not verified against a statement";

  const jobs = [
    {
      label: "OUT from ap_prepayment",
      sql: `INSERT IGNORE INTO cheque_clearing
              (side, pno, cheque_no, account, due_date, amount, party_code, party_name,
               status, cleared_date, staff, staffdate, remarks)
            SELECT 'OUT', pno, cheque_no, COALESCE(account,''), pdate, amount,
                   COALESCE(ccode,''), COALESCE(cname,''),
                   IF(pdate < ?, 'CLEARED', 'PENDING'),
                   IF(pdate < ?, pdate, NULL),
                   'BACKFILL', NOW(),
                   IF(pdate < ?, ?, '')
              FROM ap_prepayment
             WHERE rtype = 'Q' AND cheque_no <> '' AND cheque_no IS NOT NULL AND pno IS NOT NULL`,
      args: [cutoff, cutoff, cutoff, backfillRemark],
    },
    {
      label: "IN from ar_prepayment",
      sql: `INSERT IGNORE INTO cheque_clearing
              (side, pno, cheque_no, account, due_date, amount, party_code, party_name,
               status, cleared_date, staff, staffdate, remarks)
            SELECT 'IN', pno, cheque_no, COALESCE(account,''), bdate, amount,
                   COALESCE(ccode,''), COALESCE(cname,''),
                   IF(bdate < ?, 'CLEARED', 'PENDING'),
                   IF(bdate < ?, bdate, NULL),
                   'BACKFILL', NOW(),
                   IF(bdate < ?, ?, '')
              FROM ar_prepayment
             WHERE rtype = 'Q' AND cheque_no <> '' AND cheque_no IS NOT NULL AND pno IS NOT NULL`,
      args: [cutoff, cutoff, cutoff, backfillRemark],
    },
    {
      label: "OUT from cheque_entries (the 108 with no ap_prepayment match)",
      sql: `INSERT IGNORE INTO cheque_clearing
              (side, pno, cheque_no, account, due_date, amount, party_code, party_name,
               status, cleared_date, staff, staffdate, remarks)
            SELECT 'OUT', ce.code, ce.chequeno, COALESCE(ce.acct,''), ce.bdate, ce.amount,
                   COALESCE(ce.code,''), COALESCE(ce.sname,''),
                   IF(ce.bdate < ?, 'CLEARED', 'PENDING'),
                   IF(ce.bdate < ?, ce.bdate, NULL),
                   'BACKFILL', NOW(),
                   IF(ce.bdate < ?, ?, '')
              FROM cheque_entries ce
              LEFT JOIN ap_prepayment ap ON ap.cheque_no = ce.chequeno AND ap.pno = ce.code
             WHERE ap.pid IS NULL AND ce.chequeno <> '' AND ce.chequeno IS NOT NULL
               AND ce.code IS NOT NULL AND ce.bdate IS NOT NULL`,
      args: [cutoff, cutoff, cutoff, backfillRemark],
    },
  ];

  for (const job of jobs) {
    if (!APPLY) { console.log(`\nwould run: ${job.label}`); continue; }
    const r = await q(job.sql, job.args);
    console.log(`\n${job.label}: ${r.affectedRows} inserted`);
  }

  if (!APPLY) { console.log("\n(dry run — nothing written)"); return; }

  // ── 4. What it looks like now ─────────────────────────────────────
  console.log("\n-- cheque_clearing by side and status --");
  console.table(await q(
    "SELECT side, status, COUNT(*) n, ROUND(SUM(amount)) amt FROM cheque_clearing GROUP BY side, status ORDER BY side, status"));

  console.log("-- still to confirm, by day --");
  console.table(await q(
    `SELECT ${D("due_date")} due, side, COUNT(*) n, ROUND(SUM(amount)) amt
       FROM cheque_clearing WHERE status = 'PENDING'
      GROUP BY due_date, side ORDER BY due_date LIMIT 15`));

  console.log("-- what the dashboard tile will show today --");
  console.table(await q(
    `SELECT side, COUNT(*) n, ROUND(SUM(amount)) amt
       FROM cheque_clearing WHERE status = 'PENDING' AND due_date = CURDATE() GROUP BY side`));
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
