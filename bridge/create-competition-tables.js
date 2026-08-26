/**
 * Mwalimu Cosmetics — the product of the day, and the competition around it.
 *
 * ── What this is for ──────────────────────────────────────────────────
 *
 * One product is chosen each trading day. Every salesperson who sells it
 * scores a point per piece, and the standing is on the dashboard where
 * everyone can see it.
 *
 * Three days a week the product is a fast mover — something that sells
 * anyway, so the competition is about who sells it hardest. The other three
 * it is something sitting on the shelf that has barely moved in two months,
 * which is the day the competition actually earns its keep: a slow mover with
 * a point on its head is a slow mover somebody mentions to a customer.
 *
 * ── Why there is no scores table ──────────────────────────────────────
 *
 * Points are counted from pos_details at the moment the board is drawn, not
 * accumulated into a column. A running total has to be corrected when a sale
 * is voided or returned, and a total that quietly drifts from the receipts is
 * worse than no total: it is a competition people stop believing in. Counting
 * from the sales themselves cannot drift, and on a day's worth of rows it is
 * an indexed lookup.
 *
 * focus_products therefore holds only the choice, one row per day.
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");

const DDL = {
  focus_products: `
CREATE TABLE IF NOT EXISTS focus_products (
  focus_day date         NOT NULL,
  code      varchar(50)  NOT NULL,
  descr     varchar(255)     NULL,
  source    varchar(8)   NOT NULL DEFAULT 'AUTO',
  picked_at datetime         NULL,
  picked_by varchar(50)      NULL,
  PRIMARY KEY (focus_day),
  KEY ix_focus_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`
};

// focus_day is the primary key, so eleven tills opening their dashboards at
// eight in the morning race on an INSERT IGNORE and exactly one wins. The
// other ten read back the winner's row. No locking, no coordination, and the
// shop cannot end up with two products of the day.
//
// Weekday numbers follow MySQL's DAYOFWEEK(): 1 = Sunday .. 7 = Saturday.
// Sunday is left out because the shop does not trade.
const SETTINGS = [
  ["focus.enabled", "1", "Master switch for the competition."],
  ["focus.weekday.2", "FAST", "Monday: a fast mover."],
  ["focus.weekday.3", "SLOW", "Tuesday: something that has not moved."],
  ["focus.weekday.4", "FAST", "Wednesday: a fast mover."],
  ["focus.weekday.5", "SLOW", "Thursday: something that has not moved."],
  ["focus.weekday.6", "FAST", "Friday: a fast mover."],
  ["focus.weekday.7", "SLOW", "Saturday: something that has not moved."],
  ["focus.fast.days", "30", "Days of sales history that define a fast mover."],
  ["focus.fast.pool", "25", "Pick at random from the top N sellers."],
  ["focus.slow.days", "60", "Days over which a slow mover has barely sold."],
  ["focus.slow.pool", "25", "Pick at random from the N slowest that are in stock."],
  ["focus.slow.min_stock", "5", "A slow mover needs at least this many pieces to be worth a contest."],
  ["focus.cooloff.days", "14", "A product cannot be chosen again within this many days."],
  ["focus.notify", "1", "Toast the shop floor when somebody scores."],
  ["stock.notify", "1", "Toast the shop floor when stock is adjusted."]
];

const cfg = getMysqlConfig();
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
  for (const name of Object.keys(DDL)) {
    if (await tableExists(name)) {
      console.log(name + " already exists — left alone.");
    } else {
      console.log(name + " does not exist yet. It would be created as:");
      console.log(DDL[name].trim());
      if (APPLY) {
        await q(DDL[name]);
        console.log("  -> Created.");
      }
    }
  }

  if (!(await tableExists("mw_settings"))) {
    console.log("\nmw_settings does not exist. Run create-ticket-tables.js first — " +
      "it owns that table and this one only adds rows to it.");
    return;
  }

  console.log("\n-- settings --");
  for (const [key, value, why] of SETTINGS) {
    const present = await q("select svalue from mw_settings where skey = ?", [key]);
    if (present.length) {
      console.log("  " + key.padEnd(22) + " = " + present[0].svalue + "   (already set, left alone)");
    } else {
      console.log("  " + key.padEnd(22) + " = " + value + "   (seeding; " + why + ")");
      if (APPLY) {
        await q("insert into mw_settings (skey, svalue, updated, staff) values (?, ?, now(), 'setup')",
          [key, value]);
      }
    }
  }

  // The competition credits salesname/salesref, which come from the staff
  // table — not the till login. On a counter shared by two people they are
  // routinely different, and a competition that rewards whoever happened to be
  // signed in is a competition the floor will not take seriously.
  const staff = await q("select count(*) n from staff");
  const attributed = await q(
    "select count(*) n from pos_header where posted = 1 " +
    "and trandate >= date_sub(now(), interval 7 day) " +
    "and coalesce(nullif(trim(salesname),''), nullif(trim(salesref),'')) is not null");
  const total = await q(
    "select count(*) n from pos_header where posted = 1 " +
    "and trandate >= date_sub(now(), interval 7 day)");

  console.log("\n-- who the points would go to --");
  console.log("  staff table          : " + staff[0].n + " people");
  console.log("  last 7 days of sales : " + total[0].n + " receipts, " +
    attributed[0].n + " with a salesperson named");
  const pct = total[0].n ? Math.round(attributed[0].n / total[0].n * 100) : 0;
  if (total[0].n > 0 && pct < 5) {
    console.log("");
    console.log("  Note: " + pct + "% of receipts name a salesperson, so in practice points fall");
    console.log("  through to the till login — which at this shop is the person who served the");
    console.log("  customer, so the board will be right. The one thing it cannot see is two");
    console.log("  people sharing a till: they score as one. Filling in the salesperson field");
    console.log("  on the POS is what would separate them.");
  }

  if (APPLY && await tableExists("focus_products")) {
    const f = await q("select count(*) n from focus_products");
    console.log("\nfocus_products holds " + f[0].n + " day(s).");
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
