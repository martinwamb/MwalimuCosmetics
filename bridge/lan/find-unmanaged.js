/**
 * Mwalimu Cosmetics — which PCs run the POS but nothing is looking after?
 *
 * ── Why this exists ───────────────────────────────────────────────────
 *
 * The fleet list in run-on-all.ps1 is eleven hardcoded IP addresses, taken
 * from an ARP sweep on 2026-08-10. That was a snapshot, and it aged badly:
 * a twelfth till, DESKTOP-2HRTQOP, was in daily use for weeks without ever
 * appearing in it. It had no scheduled task, so it never ran check.cmd, so
 * it never received a report layout, and it never checked in — which is
 * precisely why nobody could see that it was the machine printing reprints
 * that did not say they were reprints.
 *
 * Every remote check I had went through that list, so every check agreed
 * the fleet was healthy. The one machine that was broken was the one
 * machine nothing was asking about.
 *
 * ── How it finds them ─────────────────────────────────────────────────
 *
 * Two sources, and neither is a list anybody has to maintain:
 *
 *   tickets.till   — stamped with COMPUTERNAME by TicketSlip every time a
 *                    sale prints a slip. A machine that sells appears here
 *                    within minutes, whether or not anyone knew about it.
 *
 *   the check-in   — one file per PC, rewritten by check.cmd every ten
 *   share            minutes. A machine appears here only if it has the
 *                    scheduled task, which is the definition of "managed".
 *
 * In the first list and not the second means: running the POS, receiving
 * nothing. That is the report.
 *
 * The reverse is worth knowing too — checked in but no sales for a while —
 * so a till that has quietly stopped trading is not mistaken for a healthy
 * one, though it is only ever a note, never a fault.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node bridge/lan/find-unmanaged.js
 *   node bridge/lan/find-unmanaged.js --days 30
 *   node bridge/lan/find-unmanaged.js --checkins "\\\\10.10.10.50\\checkins"
 *
 * Read-only. It writes nothing, anywhere.
 */

const fs = require("fs");
const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("../db-config.js");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DAYS = parseInt(arg("days", "14"), 10);

// Default matches agent\checkin-target.txt, which points check-ins at the
// laptop because the hub itself has no check-in share.
const CHECKINS = arg("checkins", "\\\\10.10.10.50\\checkins");

const cfg = getMysqlConfig();
const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 30000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

function readCheckins() {
  let names;
  try {
    names = fs.readdirSync(CHECKINS);
  } catch (e) {
    return { error: e.message, rows: [] };
  }
  const rows = [];
  for (const f of names) {
    if (!/\.txt$/i.test(f)) continue;
    let line = "";
    try {
      line = fs.readFileSync(CHECKINS + "\\" + f, "latin1").trim();
    } catch (e) {
      // A till mid-write. Its name is still the useful part.
    }
    // COMPUTERNAME | when | state | version | install dir | report state
    const parts = line.split("|").map(s => s.trim());
    rows.push({
      pc: (parts[0] || f.replace(/\.txt$/i, "")).toUpperCase(),
      when: parts[1] || "",
      state: parts[2] || "",
      version: parts[3] || "",
      dir: parts[4] || "",
      reports: parts[5] || "(old agent)"
    });
  }
  return { error: null, rows };
}

async function main() {
  console.log(describeConfigSource(cfg));
  console.log("Database:  " + cfg.database);
  console.log("Check-ins: " + CHECKINS);
  console.log("Window:    last " + DAYS + " days\n");

  const selling = await q(
    "select upper(till) pc, count(*) n, " +
    "  date_format(max(created), '%Y-%m-%d %H:%i') last_seen " +
    "from tickets " +
    "where till is not null and till <> '' " +
    "  and ticket_day >= date_sub(curdate(), interval ? day) " +
    "group by upper(till) order by max(created) desc", [DAYS]);

  const { error, rows: checked } = readCheckins();
  if (error) {
    console.log("Could not read the check-in share: " + error);
    console.log("Authenticate first, then re-run:");
    console.log('  net use ' + CHECKINS + ' /user:mwalimuupd MwalimuUpd2026\n');
    return;
  }

  const managed = new Set(checked.map(r => r.pc));
  const sells = new Map(selling.map(r => [r.pc, r]));

  const unmanaged = selling.filter(r => !managed.has(r.pc));

  console.log("=== PCs running the POS with NO update agent ===\n");
  if (!unmanaged.length) {
    console.log("  None. Every machine that sold anything is checking in.\n");
  } else {
    for (const r of unmanaged) {
      console.log("  " + r.pc);
      console.log("    " + r.n + " ticket(s), last " + r.last_seen);
      console.log("    Receives no builds and no report layouts. Fix by running,");
      console.log("    ON THAT PC, in an ADMINISTRATOR Command Prompt:");
      console.log("      net use \\\\10.10.10.4\\updates /user:mwalimuupd MwalimuUpd2026");
      console.log("      \\\\10.10.10.4\\updates\\agent\\setup-pc.bat");
      console.log("");
    }
  }

  console.log("=== Managed PCs ===\n");
  const stale = [];
  for (const c of checked.sort((a, b) => a.pc.localeCompare(b.pc))) {
    const s = sells.get(c.pc);
    const sold = s ? s.n + " tickets, last " + s.last_seen : "no sales in " + DAYS + " days";
    if (!s) stale.push(c.pc);
    console.log("  " + c.pc.padEnd(18) + " " + (c.state || "?").padEnd(9) +
      " " + (c.version || "?").padEnd(14) + " " + c.reports);
    console.log("  " + " ".repeat(18) + " " + sold);
  }

  // Every till should carry the same layout. One that does not is the odd
  // one out, and is exactly the shape of the fault that started this.
  const hashes = {};
  for (const c of checked) {
    if (!/^reprint-/.test(c.reports)) continue;
    (hashes[c.reports] = hashes[c.reports] || []).push(c.pc);
  }
  const variants = Object.keys(hashes);
  console.log("\n=== Receipt layout agreement ===\n");
  if (!variants.length) {
    console.log("  No till has reported a layout hash yet (they are still on the");
    console.log("  previous agent). Give them one ten-minute cycle.\n");
  } else if (variants.length === 1 && variants[0] !== "reprint-ok") {
    console.log("  All reporting tills agree: " + variants[0] + "\n");
  } else {
    for (const v of variants) {
      const tag = v === "reprint-ok"
        ? "  (old agent - existence only, content unknown)"
        : "";
      console.log("  " + v + tag);
      console.log("    " + hashes[v].join(", "));
    }
    console.log("");
  }

  if (stale.length) {
    console.log("Note: no sales in " + DAYS + " days from " + stale.join(", ") +
      " — idle, or not a till at all.");
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
