/**
 * Mwalimu Cosmetics — register the ticket board with the rights system.
 *
 * One row in sys_forms:
 *
 *   FTickets    the collection board. Every ticket issued today, oldest first,
 *               with a Ready button that tells the customer their goods are
 *               waiting.
 *
 * ── Who gets it, and why so widely ────────────────────────────────────
 *
 * Unlike FSaleLimits, this is not an administrator's screen. It is the screen
 * the people on the floor work from all day: whoever picked the goods is the
 * one who knows they are ready. Granting it narrowly would mean a picker
 * walking to find a supervisor every time a basket is finished, which is worse
 * than the standing-and-waiting the ticket was meant to fix.
 *
 * So view and edit go to everyone who can already work the till (r_vw on
 * FPosList). Cancelling a ticket is the one destructive thing on the screen and is
 * held back: r_dl is granted to nobody here, and is given deliberately in the
 * Users screen to whoever supervises the floor.
 *
 * ── About `section` ───────────────────────────────────────────────────
 *
 * Fmain.addsection builds the navigator node from whatever string the database
 * returns, and MySQL's case-insensitive collation folds spellings into one
 * GROUP BY bucket — so inventing a section where the shop already has one
 * would rename their existing node. This reads the sections that already exist
 * and reuses the shop's own spelling, exactly as seed-sale-limit-rights.js
 * does.
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");
// This shop has exactly three modules — Accounts, Stocks and Administrative
// Tools. There is no "Sales" module, however much the board sounds like one,
// and inventing one would put a lone node in their navigator. The POS itself
// lives at Accounts / Transactions, so the board belongs beside it.
const MODULE = "Accounts";
const SECTION_PREFERENCES = [/transact/i, /point.?of.?sale/i, /sale/i];
const FALLBACK_SECTION = "Transactions";

// The right whose holders should also get the board.
//
// FPosList is the POS as the navigator knows it — 32 of this shop's users hold
// view on it. FPOS, the till screen class itself, has no sys_forms row at all
// because it is opened by a button rather than from the tree, so keying off it
// would have granted the board to nobody.
const SOURCE_RIGHT = "FPosList";

const cfg = getMysqlConfig();
console.log(describeConfigSource(cfg));
console.log("Database: " + cfg.database);
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 15000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

async function resolveSection() {
  const rows = await q(
    "select section, count(*) forms from sys_forms where module = ? group by section order by forms desc",
    [MODULE]);

  if (!rows.length) {
    console.log('sys_forms has no sections under "' + MODULE + '" — will create "' + FALLBACK_SECTION + '".');
    return FALLBACK_SECTION;
  }

  console.log('Sections already under "' + MODULE + '":');
  console.table(rows);

  for (const pattern of SECTION_PREFERENCES) {
    const match = rows.find(r => pattern.test(String(r.section)));
    if (match) {
      console.log('Reusing the shop\'s own section: "' + match.section + '"\n');
      return match.section;
    }
  }
  console.log('Nothing here looks like a transactions section — will create "' + FALLBACK_SECTION + '".\n');
  return FALLBACK_SECTION;
}

// Settings screens live under Administrative Tools. This shop spells its
// section "SetUp & Configuratio" — truncated and all — so the spelling is read
// back rather than guessed, exactly as seed-sale-limit-rights.js does.
const ADMIN_MODULE = "Administrative Tools";
const ADMIN_PREFERENCES = [/config/i, /set.?up/i, /setting/i];

async function resolveAdminSection() {
  const rows = await q(
    "select section, count(*) forms from sys_forms where module = ? group by section order by forms desc",
    [ADMIN_MODULE]);
  let section = "Settings";
  if (rows.length) {
    for (const pattern of ADMIN_PREFERENCES) {
      const m = rows.find(r => pattern.test(String(r.section)));
      if (m) { section = m.section; break; }
    }
  }
  const r = await q("select `rank` from sys_forms where module = ? and section = ? limit 1",
    [ADMIN_MODULE, section]);
  const rank = (r.length && r[0].rank !== null) ? r[0].rank : 1;
  console.log('Admin panel goes to "' + ADMIN_MODULE + ' / ' + section + '"');
  return { section: section, rank: rank };
}

async function resolveRank(section) {
  const rows = await q(
    "select `rank` from sys_forms where module = ? and section = ? limit 1", [MODULE, section]);
  if (rows.length && rows[0].rank !== null) return rows[0].rank;
  const any = await q("select max(`rank`) r from sys_forms where module = ?", [MODULE]);
  return (any.length && any[0].r !== null) ? any[0].r : 1;
}

async function main() {
  const section = await resolveSection();
  const rank = await resolveRank(section);

  // FTickets belongs beside the POS, in Accounts / Transactions. The admin
  // panel does not: it is a settings screen and goes where the shop already
  // keeps those, under Administrative Tools, next to Sale Limits.
  const admin = await resolveAdminSection();

  const FORMS = [
    { f_name: "FTickets", f_caption: "Collection Tickets",
      module: MODULE, section: section, listed: "YES", rank: rank },
    { f_name: "FAdminPanel", f_caption: "Admin Panel",
      module: ADMIN_MODULE, section: admin.section, listed: "YES", rank: admin.rank }
  ];

  for (const f of FORMS) {
    const existing = await q("select `NO` from sys_forms where f_name = ?", [f.f_name]);
    if (existing.length) {
      console.log("sys_forms: " + f.f_name + " already present (NO=" + existing[0].NO + ") — left alone");
      continue;
    }
    console.log("sys_forms: INSERT " + f.f_name + " -> " + f.module + " / " + f.section +
      " (listed=" + f.listed + ", rank=" + f.rank + ")");
    if (APPLY) {
      await q("insert into sys_forms (f_name, f_caption, module, section, listed, `rank`) " +
        "values (?,?,?,?,?,?)",
        [f.f_name, f.f_caption, f.module, f.section, f.listed, f.rank]);
    }
  }

  // The admin panel goes to the people who already manage users — the same
  // rule seed-sale-limit-rights.js uses, and for the same reason: they can
  // already grant themselves any right they like, so nobody gains access they
  // did not effectively have.
  const managers = (await q(
    "select distinct code from users_rights where form_name = 'fusers' and r_vw = 1 order by code"))
    .map(r => r.code);
  const haveAdmin = new Set(
    (await q("select distinct code from users_rights where form_name = 'FAdminPanel'")).map(r => r.code));
  const needAdmin = managers.filter(c => !haveAdmin.has(c));

  console.log("\nFAdminPanel: " + managers.length + " user-managers, " +
    haveAdmin.size + " already granted, " + needAdmin.length + " to grant");
  for (const code of needAdmin) {
    if (APPLY) {
      await q("insert into users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap) " +
        "values (?,?,1,1,1,0,0)", [code, "FAdminPanel"]);
    }
  }
  if (needAdmin.length) console.log("  " + needAdmin.join(", "));

  const tillUsers = (await q(
    "select distinct code from users_rights where form_name = ? and r_vw = 1 order by code",
    [SOURCE_RIGHT])).map(r => r.code);
  const have = new Set(
    (await q("select distinct code from users_rights where form_name = 'FTickets'")).map(r => r.code));
  const need = tillUsers.filter(c => !have.has(c));

  console.log("\nFTickets: " + tillUsers.length + " till users, " +
    have.size + " already granted, " + need.length + " to grant");
  for (const code of need) {
    if (APPLY) {
      // r_vw see the board, r_ed mark ready and collected.
      // r_dl (cancel) deliberately 0 — see the header.
      await q("insert into users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap) " +
        "values (?,?,1,0,1,0,0)", [code, "FTickets"]);
    }
  }
  if (need.length) console.log("  " + need.join(", "));

  if (!tillUsers.length) {
    console.log("  NOTE: nobody holds r_vw on " + SOURCE_RIGHT + " in this database, so nobody was " +
      "granted the board. Grant FTickets by hand in the Users screen.");
  }

  console.log("\nCancelling a ticket (r_dl) is granted to nobody by default. " +
    "Give it in the Users screen to whoever supervises the floor.");

  console.log("\n-- sys_forms now --");
  console.table(await q(
    "select f_name, f_caption, module, section, listed, `rank` from sys_forms " +
    "where f_name in ('FTickets','FAdminPanel')"));
  console.log("-- users_rights now --");
  console.table(await q(
    "select form_name, count(*) users, sum(r_vw) with_view, sum(r_ed) can_mark_ready, " +
    "sum(r_dl) can_cancel from users_rights where form_name in ('FTickets','FAdminPanel') " +
    "group by form_name"));
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
