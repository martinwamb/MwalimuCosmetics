/**
 * Mwalimu Cosmetics — top up mwalimuinvest_test so ticketing can be tested on it.
 *
 * The test database was created by pusher.js's own self-test and holds only the
 * handful of tables that self-test needed: pos_header, pos_details, accounts,
 * nauto and a few ledger tables. That is not enough to exercise a collection
 * ticket end to end.
 *
 * Missing, and why each is needed:
 *
 *   pu               get_smallest_qty reads its `factor` column. Without it a
 *                    carton and a piece both count as one.
 *   get_smallest_qty the function itself. Ticket unit counts and the express
 *                    test both go through it, exactly as the till does.
 *   si               product master. The board and the admin screens show a
 *                    description rather than a bare barcode.
 *   sq               stock cache, used to pick a focus product that is
 *                    actually on the shelf.
 *   staff            salespeople. pos_header.salesref points here, and it is
 *                    who the leaderboard credits.
 *   sys_forms        screen registry. Without it a new screen cannot be
 *                    registered or its rights granted.
 *   users_rights     per-user rights rows.
 *   users            login accounts.
 *
 * Structure and data are copied from mwalimuinvest so the test database is the
 * shop's own shapes, not a developer's guess at them. Nothing is ever written
 * back to mwalimuinvest: every statement here writes to the test database only,
 * and the script refuses to run if the target is not a _test database.
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./../db-config.js");

const APPLY = process.argv.includes("--apply");
const SOURCE = "mwalimuinvest";
const TABLES = [
  // Ticketing and the screens around it
  "pu", "si", "sq", "staff", "sys_forms", "users_rights", "users",
  // The Crystal receipt. Modreports.get_comp_settings fills a shared DataSet
  // from these before any receipt is rendered, so without them the report has
  // no company name, no logo and no cashier name to print.
  "comp", "imagecollection", "img", "developed_by",
  // Written by the payment and posting paths a real sale goes through.
  "pos_payment_details", "prepaid"
];

// All 87 stored routines, from the capture of the live database.
//
// An earlier version of this script installed only get_smallest_qty, on the
// grounds that it was the only one ticketing needed. That was true of
// ticketing and false of everything around it: the Crystal receipt calls
// get_payref, and get_comp_settings calls get_currency_factor, get_ar_paid and
// get_ap_paid. A receipt cannot be rendered without them. Installing the lot is
// both simpler and closer to what a test database is for.
//
// routines.sql is written for the mysql client, with DELIMITER $$ around each
// body. The node driver has no notion of DELIMITER, so the file is split on $$
// and each statement is sent on its own.
const fs = require("fs");
const path = require("path");
const ROUTINES_SQL = path.join(__dirname, "..", "..", "db", "routines.sql");

function readRoutines() {
  if (!fs.existsSync(ROUTINES_SQL)) return [];
  return fs.readFileSync(ROUTINES_SQL, "utf8")
    .replace(/^DELIMITER.*$/gm, "")
    .split("$$")
    .map(s => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(s => s.length > 0);
}

const cfg = getMysqlConfig();
const target = cfg.database;

// A script that copies tables wholesale has no business pointing at the real
// database, whatever the environment happens to say.
if (!/_test$/.test(target)) {
  console.error("REFUSING: target database is '" + target + "', which is not a _test database.");
  console.error("Set MWALIMU_DB_NAME=mwalimuinvest_test to run this.");
  process.exit(1);
}

console.log(describeConfigSource(cfg));
console.log("Source: " + SOURCE + "   Target: " + target);
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 120000 }, args || [], (e, r) => (e ? rej(e) : res(r))));


// Every table that exists in the live database but not here, created empty.
//
// The receipt path, the posting path and the report helpers between them touch
// far more tables than ticketing does, and a missing one is an error thrown
// from somewhere deep in vendor code with no useful message. Structure-only is
// cheap — no rows are copied — and it means any query that is valid against
// the live database is at least valid here.
async function structureForAll() {
  const missing = await q(
    "select t.table_name from information_schema.tables t " +
    "where t.table_schema = ? and t.table_type = 'BASE TABLE' " +
    "and t.table_name not in (select table_name from information_schema.tables where table_schema = ?)",
    [SOURCE, target]);

  console.log("\nTables in " + SOURCE + " but not here: " + missing.length);
  if (!missing.length) return;
  if (!APPLY) { console.log("  would create all of them empty."); return; }

  let made = 0, failed = 0;
  for (const row of missing) {
    const t = row.table_name;
    try {
      await q("CREATE TABLE " + target + "." + t + " LIKE " + SOURCE + "." + t);
      made++;
    } catch (e) {
      failed++;
      console.log("  could not create " + t + ": " + e.message.split("\n")[0]);
    }
  }
  console.log("  created " + made + " empty table(s)" + (failed ? ", " + failed + " failed" : ""));
}

async function main() {
  for (const t of TABLES) {
    const here = await q(
      "select table_name from information_schema.tables where table_schema=? and table_name=?",
      [target, t]);

    if (here.length) {
      const n = await q("select count(*) n from " + t);
      console.log(t.padEnd(14) + "already present (" + n[0].n + " rows) — left alone.");
      continue;
    }

    const src = await q(
      "select table_rows from information_schema.tables where table_schema=? and table_name=?",
      [SOURCE, t]);
    if (!src.length) {
      console.log(t.padEnd(14) + "NOT IN SOURCE — skipped.");
      continue;
    }

    console.log(t.padEnd(14) + "would copy structure + data (~" + src[0].table_rows + " rows)");
    if (APPLY) {
      await q("CREATE TABLE " + target + "." + t + " LIKE " + SOURCE + "." + t);
      await q("INSERT INTO " + target + "." + t + " SELECT * FROM " + SOURCE + "." + t);
      const n = await q("select count(*) n from " + t);
      console.log("".padEnd(14) + "  -> copied " + n[0].n + " rows.");
    }
  }

  await structureForAll();

  const before = (await q(
    "select routine_name from information_schema.routines where routine_schema=?", [target])).length;
  const statements = readRoutines();
  const creates = statements.filter(s => /^CREATE/i.test(s)).length;

  console.log("\nStored routines: " + before + " present here, " + creates + " in db/routines.sql");

  if (!statements.length) {
    console.log("  db/routines.sql not found — skipped.");
  } else if (!APPLY) {
    console.log("  would drop and recreate all of them.");
  } else {
    let made = 0, failed = 0;
    for (const s of statements) {
      try {
        await q(s);
        if (/^CREATE/i.test(s)) made++;
      } catch (e) {
        // A DROP of something absent is expected and uninteresting. A CREATE
        // that fails is worth seeing but must not stop the rest: routines
        // depend on tables, and this test database deliberately has only some.
        if (/^CREATE/i.test(s)) {
          failed++;
          const m = s.match(/(FUNCTION|PROCEDURE)\s+`?(\w+)`?/i);
          console.log("  could not create " + (m ? m[2] : "?") + ": " + e.message.split("\n")[0]);
        }
      }
    }
    console.log("  created " + made + ", failed " + failed);
  }

  if (APPLY) {
    // Prove it agrees with the source, rather than merely existing. A factor
    // read from the wrong pu row would be silently wrong everywhere.
    const check = await q(
      "select p.code, p.factor, get_smallest_qty(2, p.code) two from pu p " +
      "where p.factor > 1 order by p.factor desc limit 3");
    console.log("\nget_smallest_qty spot check (2 x unit):");
    check.forEach(r =>
      console.log("  " + String(r.code).padEnd(12) + "factor " + r.factor +
                  "  -> " + r.two + (r.two === 2 * r.factor ? "  OK" : "  WRONG")));
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
