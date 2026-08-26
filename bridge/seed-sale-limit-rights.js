/**
 * Mwalimu Cosmetics — register the sale limits screen with the rights system.
 *
 * Two rows in sys_forms:
 *
 *   FSaleLimits          the screen itself, so it appears in the navigator and
 *                        can be opened to set a maximum on a product.
 *
 *   FSaleLimitOverride   a right with no form behind it (listed='NO'). It lets
 *                        the holder push a sale past a limit at the till
 *                        without being asked for the shop's passkey. Everyone
 *                        else has to enter it, and either way the override is
 *                        written to systemaudit.
 *
 * listed='NO' keeps FSaleLimitOverride out of the navigator (Fmain.addcaption
 * filters listed='YES') while still showing it in the Users rights grid
 * (fusers.load_rights_ has no such filter). FDashboardMoney and ForderbySales
 * already do exactly this, so it is an established pattern here.
 *
 * ── About `section` ───────────────────────────────────────────────────
 *
 * Fmain.addsection builds the tree node caption from whatever string the
 * database returns, and MySQL's case-insensitive collation folds spellings
 * into one GROUP BY bucket — so inventing "SETTINGS" where the shop already
 * has "Settings" would rename their existing node. This script therefore does
 * not guess: it reads the sections that already exist under Administrative
 * Tools and reuses the shop's own spelling, only falling back to creating one
 * when there is genuinely nothing to reuse.
 *
 * ── Who gets what ─────────────────────────────────────────────────────
 *
 *   FSaleLimits         -> users who already have view rights on `fusers`,
 *                          i.e. people who can already grant themselves any
 *                          right they like. Nobody gains access they did not
 *                          already effectively have.
 *
 *   FSaleLimitOverride  -> nobody, by default. A limit that everyone can wave
 *                          through is not a limit. Grant it deliberately in
 *                          the Users screen to whoever supervises the floor.
 *
 * Usercode ADMIN is force-granted everything inside mglobal.allow_me_
 * regardless of any of this.
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");
const MODULE = "Administrative Tools";
// Tried in order against the sections the shop already has. Reusing one of
// theirs is always better than adding a node to their menu, and this shop
// keeps its configuration screens under "SetUp & Configuratio" — their
// spelling, truncated and all.
const SECTION_PREFERENCES = [/config/i, /set.?up/i, /setting/i];
const FALLBACK_SECTION = "Settings";

const cfg = getMysqlConfig();
console.log(describeConfigSource(cfg));
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 15000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

// Reuse the shop's own spelling of a section rather than imposing one.
async function resolveSection() {
  const rows = await q(
    "select section, count(*) forms from sys_forms where module = ? group by section order by forms desc",
    [MODULE]);

  if (!rows.length) {
    console.log(`sys_forms has no sections under "${MODULE}" at all — will create "${FALLBACK_SECTION}".`);
    return FALLBACK_SECTION;
  }

  console.log(`Sections already under "${MODULE}":`);
  console.table(rows);

  for (const pattern of SECTION_PREFERENCES) {
    const match = rows.find(r => pattern.test(String(r.section)));
    if (match) {
      console.log(`Reusing the shop's own section: "${match.section}"
`);
      return match.section;
    }
  }
  console.log(`Nothing here looks like a settings section — will create "${FALLBACK_SECTION}".
`);
  return FALLBACK_SECTION;
}

// rank orders the sections within a module, not the forms inside one (those
// order by f_caption), so it is taken from the module's own rows rather than
// invented.
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

  const FORMS = [
    { f_name: "FSaleLimits", f_caption: "Sale Limits", listed: "YES" },
    { f_name: "FSaleLimitOverride", f_caption: "Sale Limits: override at the till", listed: "NO" },
  ];

  for (const f of FORMS) {
    const existing = await q("select `NO` from sys_forms where f_name = ?", [f.f_name]);
    if (existing.length) {
      console.log(`sys_forms: ${f.f_name} already present (NO=${existing[0].NO}) — left alone`);
      continue;
    }
    console.log(`sys_forms: INSERT ${f.f_name} -> ${MODULE} / ${section} (listed=${f.listed}, rank=${rank})`);
    if (APPLY) {
      await q(
        "insert into sys_forms (f_name, f_caption, module, section, listed, `rank`) values (?,?,?,?,?,?)",
        [f.f_name, f.f_caption, MODULE, section, f.listed, rank]);
    }
  }

  // ---- FSaleLimits for the people who already manage users ----------
  const managers = (await q(
    "select distinct code from users_rights where form_name = 'fusers' and r_vw = 1 order by code"))
    .map(r => r.code);
  const have = new Set(
    (await q("select distinct code from users_rights where form_name = 'FSaleLimits'"))
      .map(r => r.code));
  const need = managers.filter(c => !have.has(c));

  console.log(`\nFSaleLimits: ${managers.length} user-managers, ` +
    `${have.size} already granted, ${need.length} to grant`);
  for (const code of need) {
    if (APPLY) {
      // View and edit: setting a limit is the only thing the screen does, so
      // view without edit would be a screen that cannot be used.
      await q(
        "insert into users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap) values (?,?,1,1,1,1,0)",
        [code, "FSaleLimits"]);
    }
  }
  if (need.length) console.log("  " + need.join(", "));

  console.log("\nFSaleLimitOverride: granted to nobody by default. " +
    "Give it in the Users screen (r_ap) to whoever should be able to sell past a limit " +
    "without the passkey.");

  console.log("\n-- sys_forms now --");
  console.table(await q(
    "select f_name, f_caption, module, section, listed, `rank` from sys_forms where f_name like 'FSaleLimit%'"));
  console.log("-- users_rights now --");
  console.table(await q(
    "select form_name, count(*) users, sum(r_vw) with_view, sum(r_ed) with_edit, sum(r_ap) with_override " +
    "from users_rights where form_name like 'FSaleLimit%' group by form_name"));
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
