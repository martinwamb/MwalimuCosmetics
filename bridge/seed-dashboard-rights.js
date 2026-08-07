/**
 * Mwalimu Cosmetics — register the FumasV5 dashboard with the rights system.
 *
 * Two rows in sys_forms:
 *
 *   FDashboard        the menu item, under Stocks -> Transactions, so the
 *                     dashboard can be reopened after it is closed instead of
 *                     only appearing once at login.
 *
 *   FDashboardMoney   a right with no form behind it (listed='NO'). It gates
 *                     the money on the dashboard: takings, gross profit,
 *                     purchase values, supplier balances. Without it the
 *                     screen still shows receipt counts, quantities and what
 *                     goods have arrived — useful to a cashier, and silent
 *                     about the day's money.
 *
 * listed='NO' keeps FDashboardMoney out of the navigator (Fmain.addcaption
 * filters listed='YES') while still showing it in the Users rights grid
 * (fusers.load_rights_ has no such filter). ForderbySales already does exactly
 * this, so it is an established pattern here rather than a new trick.
 *
 * section is 'Transactions', NOT 'TRANSACTIONS'. Fmain.addsection builds the
 * tree node caption from whatever string the database returns, and MySQL's
 * case-insensitive collation folds both spellings into one GROUP BY bucket —
 * so the wrong case could rename the shop's existing Transactions node.
 *
 * rank is 2, matching the other Stocks/Transactions forms. rank orders the
 * *sections* within a module, not the forms inside one (those order by
 * f_caption), so an out-of-band value could reshuffle the Stocks menu.
 *
 * Rights granted here:
 *
 *   FDashboard      -> every user who already has any rights row. The
 *                      dashboard already opens automatically at login for
 *                      everyone, so this exposes nothing new; it just makes
 *                      it reachable again afterwards.
 *
 *   FDashboardMoney -> only users who already have view rights on `fusers`,
 *                      i.e. people who can already grant themselves any right
 *                      they like. Nobody gains access they did not already
 *                      effectively have. Usercode ADMIN is force-granted
 *                      everything inside mglobal.allow_me_ regardless.
 *
 * Hand-written users_rights rows survive: fusers.save_rights_ only deletes and
 * rewrites a row when its grid row is flagged in column 7, and load_rights_
 * reads existing rows back as ticked. So re-saving a user in the Users screen
 * preserves what this script sets.
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");

const FORMS = [
  {
    f_name: "FDashboard",
    f_caption: "Dashboard",
    module: "Stocks",
    section: "Transactions",
    listed: "YES",
    rank: 2,
  },
  {
    f_name: "FDashboardMoney",
    f_caption: "Dashboard: financial figures",
    module: "Stocks",
    section: "Transactions",
    listed: "NO",
    rank: 2,
  },
];

const cfg = getMysqlConfig();
console.log(describeConfigSource(cfg));
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 15000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

async function main() {
  // ---- 1. sys_forms -------------------------------------------------
  for (const f of FORMS) {
    const existing = await q("select `NO` from sys_forms where f_name = ?", [f.f_name]);
    if (existing.length) {
      console.log(`sys_forms: ${f.f_name} already present (NO=${existing[0].NO}) — left alone`);
      continue;
    }
    console.log(`sys_forms: INSERT ${f.f_name} -> ${f.module} / ${f.section} (listed=${f.listed}, rank=${f.rank})`);
    if (APPLY) {
      await q(
        "insert into sys_forms (f_name, f_caption, module, section, listed, `rank`) values (?,?,?,?,?,?)",
        [f.f_name, f.f_caption, f.module, f.section, f.listed, f.rank]);
    }
  }

  // ---- 2. FDashboard for everyone who already has any rights --------
  const allUsers = await q(
    "select distinct code from users_rights where code is not null and code <> '' order by code");
  const haveDash = new Set(
    (await q("select distinct code from users_rights where form_name = 'FDashboard'"))
      .map(r => r.code));
  const needDash = allUsers.map(r => r.code).filter(c => !haveDash.has(c));

  console.log(`\nFDashboard (menu item): ${allUsers.length} users total, ` +
    `${haveDash.size} already granted, ${needDash.length} to grant`);
  for (const code of needDash) {
    if (APPLY) {
      await q(
        "insert into users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap) values (?,?,1,0,0,0,0)",
        [code, "FDashboard"]);
    }
  }
  if (needDash.length) console.log("  " + needDash.join(", "));

  // ---- 3. FDashboardMoney for existing user-managers ----------------
  const managers = (await q(
    "select distinct code from users_rights where form_name = 'fusers' and r_vw = 1 order by code"))
    .map(r => r.code);
  const haveMoney = new Set(
    (await q("select distinct code from users_rights where form_name = 'FDashboardMoney'"))
      .map(r => r.code));
  const needMoney = managers.filter(c => !haveMoney.has(c));

  console.log(`\nFDashboardMoney (money right): ${managers.length} user-managers, ` +
    `${haveMoney.size} already granted, ${needMoney.length} to grant`);
  for (const code of needMoney) {
    if (APPLY) {
      await q(
        "insert into users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap) values (?,?,1,0,0,0,0)",
        [code, "FDashboardMoney"]);
    }
  }
  if (needMoney.length) console.log("  " + needMoney.join(", "));

  // ---- 4. Show the result ------------------------------------------
  console.log("\n-- sys_forms now --");
  console.table(await q(
    "select f_name, f_caption, module, section, listed, `rank` from sys_forms where f_name like 'FDashboard%'"));
  console.log("-- users_rights now --");
  console.table(await q(
    "select form_name, count(*) users, sum(r_vw) with_view from users_rights " +
    "where form_name like 'FDashboard%' group by form_name"));
  console.log("-- who can see the money --");
  console.table(await q(
    "select code from users_rights where form_name='FDashboardMoney' and r_vw=1 order by code"));
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
