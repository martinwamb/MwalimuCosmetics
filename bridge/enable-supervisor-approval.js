/**
 * Mwalimu Cosmetics — move an override off the shared passkey.
 *
 * ── What the passkey is ───────────────────────────────────────────────
 *
 * One value in comp.passk, compared as plain text, opening all thirty-five
 * override prompts in the POS: sale limits, selling under price, bonus
 * quantities, reprints. On that path NO right is checked — whoever knows the
 * word can override anything, anywhere. And the audit trail can only ever say
 * that somebody who knew the passkey did it, never who.
 *
 * ── What replaces it ──────────────────────────────────────────────────
 *
 * A supervisor signs in, and their approve right FOR THAT ACTIVITY is checked
 * (users_rights.r_ap), and their name goes in the audit trail. None of that
 * machinery is new — mglobal.allow_me_verify already does it, and the
 * fingerprint path already works this way. The passkey was bypassing it.
 *
 * ── The guard, which is the point of this script ──────────────────────
 *
 * seed-sale-limit-rights.js grants FSaleLimitOverride to NOBODY on purpose.
 * So switching to sign-in before anyone holds it would leave a till where the
 * limit cannot be overridden at all — worse than the shared passkey, and
 * discovered at a counter with a customer waiting.
 *
 * This refuses to enable sign-in until at least one person can actually
 * approve, and tells you who they are.
 *
 * Usage:
 *   node bridge/enable-supervisor-approval.js                 # show the state
 *   node bridge/enable-supervisor-approval.js --grant ANN,JANET --apply
 *   node bridge/enable-supervisor-approval.js --mode login --apply
 *   node bridge/enable-supervisor-approval.js --mode passkey --apply   # revert
 *
 * Dry run by default. Nothing is written without --apply.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const ACTIVITY = "FSaleLimitOverride";
const SETTING = "approval.mode." + ACTIVITY;

const APPLY = process.argv.includes("--apply");

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
}

const grantTo = (arg("grant") || "").split(",").map(s => s.trim()).filter(Boolean);
const mode = arg("mode");

const cfg = getMysqlConfig();
const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 30000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

async function holders() {
  return await q(
    "select r.code, u.username from users_rights r " +
    "left join users u on u.usercode = r.code " +
    "where r.form_name = ? and r.r_ap = 1 order by r.code", [ACTIVITY]);
}

async function main() {
  console.log(describeConfigSource(cfg));
  console.log("Database: " + cfg.database);
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

  // ---- who can approve today ----------------------------------------
  let can = await holders();
  console.log("Who can approve a sale-limit override right now:");
  if (!can.length) console.log("  nobody");
  for (const r of can) console.log("  " + String(r.code).padEnd(14) + (r.username || ""));

  // ---- grants --------------------------------------------------------
  if (grantTo.length) {
    console.log("\nGranting " + ACTIVITY + " (approve) to: " + grantTo.join(", "));
    for (const code of grantTo) {
      const who = await q("select usercode, username from users where usercode = ?", [code]);
      if (!who.length) {
        console.log("  " + code.padEnd(14) + "NO SUCH USER — skipped");
        continue;
      }
      const existing = await q(
        "select r_ap from users_rights where code = ? and form_name = ?", [code, ACTIVITY]);

      if (existing.length && String(existing[0].r_ap) === "1") {
        console.log("  " + code.padEnd(14) + "already had it");
        continue;
      }

      console.log("  " + code.padEnd(14) + (existing.length ? "granting approve" : "adding the right"));
      if (APPLY) {
        if (existing.length) {
          await q("update users_rights set r_ap = 1 where code = ? and form_name = ?", [code, ACTIVITY]);
        } else {
          // View alongside approve: a right that can be exercised but not seen
          // reads as missing in the Users screen.
          await q(
            "insert into users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap) values (?,?,1,0,0,0,1)",
            [code, ACTIVITY]);
        }
      }
    }
    if (APPLY) can = await holders();
  }

  // ---- the switch ----------------------------------------------------
  const current = await q("select svalue from mw_settings where skey = ?", [SETTING]);
  const now = current.length ? current[0].svalue : "(unset — passkey)";
  console.log("\n" + SETTING + " = " + now);

  if (!mode) {
    console.log("\nPass --mode login to switch this override to supervisor sign-in,");
    console.log("or --mode passkey to put it back. Nothing changed.");
    return;
  }

  if (mode.toLowerCase() === "login" && !can.length) {
    console.log("\nREFUSING to switch to sign-in: nobody holds approve on " + ACTIVITY + ".");
    console.log("Every override would be impossible, which is worse than the shared passkey");
    console.log("and would be found out at a till with a customer waiting.");
    console.log("\nGrant it first, e.g.:");
    console.log("  node bridge/enable-supervisor-approval.js --grant ANN,JANET --apply");
    process.exitCode = 1;
    return;
  }

  console.log("Setting " + SETTING + " = " + mode.toLowerCase());
  if (APPLY) {
    if (current.length) {
      await q("update mw_settings set svalue = ?, updated = now(), staff = 'setup' where skey = ?",
        [mode.toLowerCase(), SETTING]);
    } else {
      await q("insert into mw_settings (skey, svalue, updated, staff) values (?, ?, now(), 'setup')",
        [SETTING, mode.toLowerCase()]);
    }
    console.log("  -> done. Tills pick it up within a minute (MwSettings caches for 60s).");
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
