/**
 * Mwalimu Cosmetics — retire the original FumasV5 dashboard from the rights system.
 *
 * FDashboard, the original dashboard (the day's takings, customers served and
 * the rest), is being removed from FumasV5 at the owner's request. FHome, the
 * sign-in screen, stays exactly as it is.
 *
 * seed-dashboard-rights.js registered it with a sys_forms row under Stocks ->
 * Transactions and a users_rights row for every user. This deletes exactly
 * those, and nothing else:
 *
 *   users_rights  where form_name = 'FDashboard'
 *   sys_forms     where f_name    = 'FDashboard'
 *
 * It does NOT touch FDashboardMoney. That right has no form behind it and
 * outlives the one it was named after: it still gates FHome's Show more, and
 * the Attendance tab inside it. So every statement here is an exact match,
 * never LIKE 'FDashboard%', which would take FDashboardMoney with it, and the
 * script counts FDashboardMoney's rows before and after to prove they are all
 * still there.
 *
 * RUN THIS BEFORE the build without FDashboard.cs reaches the tills. The
 * navigator builds its tree from sys_forms, so a till on the new build against
 * a database that still lists FDashboard would offer a menu item whose form no
 * longer exists. The other order costs nothing: an old build loses the menu
 * entry, and the toolbar button, which asks allow_me_ for the same right. Only
 * usercode ADMIN, whom allow_me_ grants everything regardless, keeps a working
 * button on an old build, and it opens the old form still inside that exe.
 *
 * Dry run by default. Pass --apply to write. --db points it at another
 * database, as the create-*.js scripts do.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");

// --db for the reason given in create-ticket-tables.js: MWALIMU_DB_NAME on its
// own silently falls back to the legacy config and the production database.
const dbIndex = process.argv.indexOf("--db");
const dbName = dbIndex !== -1 && process.argv[dbIndex + 1] ? process.argv[dbIndex + 1] : null;

const cfg = getMysqlConfig(dbName ? { database: dbName } : undefined);
console.log(describeConfigSource(cfg));
console.log("Database: " + cfg.database);
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 15000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

// Filtered on the whole FDashboard family, so FDashboardMoney is on screen
// beside the row being removed. `leaving` drops the retired rows from the
// listing, which is how a dry run shows what the database would be left with.
// `rank` is backticked: it is a reserved word on newer MySQL, and every other
// script here writes it that way.
async function show(label, leaving) {
  const skipForm  = leaving ? " and f_name <> 'FDashboard'" : "";
  const skipRight = leaving ? " and form_name <> 'FDashboard'" : "";
  console.log("\n-- sys_forms " + label + " --");
  console.table(await q(
    "select `NO`, f_name, f_caption, module, section, listed, `rank` from sys_forms " +
    "where f_name like 'FDashboard%'" + skipForm + " order by f_name"));
  console.log("-- users_rights " + label + " --");
  console.table(await q(
    "select form_name, count(*) users, sum(r_vw) with_view from users_rights " +
    "where form_name like 'FDashboard%'" + skipRight + " group by form_name order by form_name"));
}

async function moneyRows() {
  const f = await q("select count(*) n from sys_forms where f_name = 'FDashboardMoney'");
  const r = await q("select count(*) n from users_rights where form_name = 'FDashboardMoney'");
  return { forms: Number(f[0].n), rights: Number(r[0].n) };
}

async function main() {
  await show("before", false);
  const moneyBefore = await moneyRows();

  const holders = (await q(
    "select code from users_rights where form_name = 'FDashboard' order by code")).map(r => r.code);
  const forms = await q("select `NO` from sys_forms where f_name = 'FDashboard'");

  console.log("\nusers_rights: " + holders.length + " FDashboard row(s) to delete");
  if (holders.length) console.log("  " + holders.join(", "));
  console.log("sys_forms: " + forms.length + " FDashboard row(s) to delete" +
    (forms.length ? " (NO=" + forms.map(f => f.NO).join(", ") + ")" : ""));

  if (APPLY) {
    const r = await q("delete from users_rights where form_name = 'FDashboard'");
    const f = await q("delete from sys_forms where f_name = 'FDashboard'");
    console.log("  -> Deleted " + r.affectedRows + " users_rights and " +
      f.affectedRows + " sys_forms row(s).");
  }

  await show(APPLY ? "after" : "after (what --apply would leave)", !APPLY);

  const moneyAfter = await moneyRows();
  if (moneyAfter.forms !== moneyBefore.forms || moneyAfter.rights !== moneyBefore.rights) {
    console.error("\nFDashboardMoney CHANGED: " + JSON.stringify(moneyBefore) + " -> " +
      JSON.stringify(moneyAfter) + ". Show more and the Attendance tab are gated on it; restore it.");
    process.exitCode = 1;
  } else {
    console.log("\nFDashboardMoney untouched: " + moneyAfter.forms + " sys_forms row, " +
      moneyAfter.rights + " users_rights row(s).");
  }

  if (!APPLY) console.log("\nDry run. Nothing written. Add --apply to make these changes.");
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
