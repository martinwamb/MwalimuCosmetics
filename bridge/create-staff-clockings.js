/**
 * Mwalimu Cosmetics — staff_clockings, the till's copy of the web clock-in.
 *
 * ── What this is for ──────────────────────────────────────────────────
 *
 * Staff clock in and out on the shop tablet, and those shifts live in the web
 * app's Postgres. The Attendance tab in FumasV5's Show more (FStaffPerformance)
 * shows them beside the sales figures, and the till cannot fetch them itself:
 * the tills have no internet, FumasV5 is .NET 3.5 and cannot be trusted with
 * TLS 1.2, and the server cannot reach the shop's MySQL. So the sync agent
 * (pusher.js, pullClockings) copies them down into this table, and the till
 * reads it like any other.
 *
 * ── A copy, with one writer ──────────────────────────────────────────
 *
 * Postgres is the record. Nothing in FumasV5 writes here, and a row changed by
 * hand inside the agent's window is put back on its next pass: it upserts
 * every shift the server returns and deletes every row in the window the
 * server no longer has. That is also how a shift deleted on the web
 * disappears here.
 *
 * id is the Postgres Clocking.id rather than a local auto-increment, and both
 * halves depend on it: the upsert has a key to land on, and the delete has
 * something to compare against.
 *
 * ── Times ─────────────────────────────────────────────────────────────
 *
 * time_in and time_out are EAT wall time, like every other datetime in this
 * database, so the till can put them beside a sale's trandate without
 * converting anything. time_out is NULL while the person is still in.
 * synced_at is the agent's own clock, never NOW(): the server-pc's clock runs
 * about 24 minutes fast.
 *
 *   node create-staff-clockings.js                          # dry run
 *   node create-staff-clockings.js --apply                  # writes
 *   node create-staff-clockings.js --db mwalimuinvest_test --apply
 *
 * The agent skips the pull silently until the table exists, and the
 * Attendance tab says it has not synced yet, so nothing breaks in either
 * order. Run it before the build reaches the tills all the same, so that
 * message is never what the owner sees first.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");

// id is varchar(30): a Postgres cuid is 25 characters.
//
// The index is on time_in because every read is a date range - one day, or the
// From/To on the Attendance tab - and so is the agent's delete. Without it
// each of those is a scan, which on MySQL 5.1 grows with every shift ever
// worked.
const DDL = `
CREATE TABLE IF NOT EXISTS staff_clockings (
  id         varchar(30) NOT NULL,
  staff_name varchar(80) NOT NULL DEFAULT '',
  time_in    datetime    NOT NULL,
  time_out   datetime        NULL,
  synced_at  datetime    NOT NULL,
  PRIMARY KEY (id),
  KEY staff_clockings_time_in (time_in)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

// --db for the reason given in create-ticket-tables.js: MWALIMU_DB_NAME on its
// own silently falls back to the legacy config and the production database.
const dbIndex = process.argv.indexOf("--db");
const dbName = dbIndex !== -1 && process.argv[dbIndex + 1] ? process.argv[dbIndex + 1] : null;

// dateStrings only so the summary below prints the stored wall time as it is,
// rather than as a Date shifted by the UTC+3 offset.
const cfg = getMysqlConfig({ ...(dbName ? { database: dbName } : {}), dateStrings: true });
console.log(describeConfigSource(cfg));
console.log("Database: " + cfg.database);
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 30000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

async function tableExists(name) {
  const rows = await q(
    "select table_name from information_schema.tables " +
    "where table_schema = database() and table_name = ?", [name]);
  return rows.length > 0;
}

async function main() {
  if (await tableExists("staff_clockings")) {
    console.log("staff_clockings already exists — left alone.");
  } else {
    console.log("staff_clockings does not exist yet. It would be created as:");
    console.log(DDL.trim());
    if (APPLY) {
      await q(DDL);
      console.log("  -> Created.");
    }
  }

  // What is actually there, read back, rather than what this script meant to
  // create: a table somebody made by hand under the same name would otherwise
  // be reported as fine.
  if (await tableExists("staff_clockings")) {
    const def = await q("SHOW CREATE TABLE staff_clockings");
    console.log("\n" + def[0]["Create Table"]);
    const s = (await q(
      "select count(*) n, min(time_in) first_in, max(time_in) last_in, max(synced_at) last_sync " +
      "from staff_clockings"))[0];
    console.log("\nstaff_clockings holds " + s.n + " row(s)" +
      (Number(s.n) ? "; time_in " + s.first_in + " to " + s.last_in +
                     "; last synced " + s.last_sync + "." : "."));
  }

  if (!APPLY) console.log("\nDry run. Nothing written. Add --apply to make these changes.");
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
