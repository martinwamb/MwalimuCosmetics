/**
 * Mwalimu Cosmetics — pos_extras, and the settings for the three till features.
 *
 * ── What this is for ──────────────────────────────────────────────────
 *
 * Two things the shop wants recorded against a sale that the vendor's
 * pos_header has nowhere to put:
 *
 *   1. DISPATCH. Above a threshold the goods are going somewhere rather than
 *      over the counter, and the receipt should say who is receiving them,
 *      on what number, and where.
 *
 *   2. WHICH ORDER OF THE DAY THIS IS. The same customer's order can be rung
 *      twice by two people at two tills. The cashier is now warned, and if
 *      they go ahead the receipt says "RECEIPT 2 OF 2 TODAY" so the packer
 *      and the customer can both see it.
 *
 * ── Why a new table rather than columns on pos_header ─────────────────
 *
 * Same reasoning as the ticket tables. pos_header is written by the vendor's
 * POS, by the returns path and by the draft path; a column there makes every
 * one of those a writer of this feature. pos_extras has exactly one writer,
 * FChangePaymentOptM.save_(), and one reader, ReceiptTail at print time.
 *
 * ── Why ONE table and not two ─────────────────────────────────────────
 *
 * Both facts are the same shape: something extra known about one receipt,
 * written once, read once. Two tables would mean two round trips inside
 * rpt_pos_R_auto — on the printing path, in front of a queue.
 *
 * It is deliberately NOT called `dispatch`. That is an existing vendor table
 * holding sales reps and routes, read in 68 places.
 *
 * ── Why receiptno is the primary key ──────────────────────────────────
 *
 * Idempotency, for free. Written with `insert ... on duplicate key update`, a
 * double-press of Pay or a retried post cannot produce a second row, and a
 * reprint reads back exactly what the original receipt printed.
 *
 * And why repeat_ord is STORED rather than recomputed at print time: a
 * recomputed ordinal would come out different on a reprint after a later sale,
 * or after an earlier one was voided, or after the customer's name was
 * corrected. That is precisely the bug 952c1e4 fixed for the ticket number.
 *
 *   node create-pos-extras.js                 # dry run, shows everything
 *   node create-pos-extras.js --apply         # writes
 *   node create-pos-extras.js --db mwalimuinvest_test --apply
 *
 * RUN THIS BEFORE THE BUILD REACHES THE TILLS. A till whose database has no
 * pos_extras prints exactly the receipt it prints today - every read is inside
 * a try/catch that returns "no extras" - but the features do nothing until the
 * table is there.
 */

const mysql = require("mysql");
const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");

const APPLY = process.argv.includes("--apply");

const DDL = {
  pos_extras:
    "CREATE TABLE pos_extras (\n" +
    // varchar(20) to match pos_header.receiptno and pos_details.receiptno
    // exactly. On MySQL 5.1 a width or charset mismatch here is the
    // difference between a seek and a scan on every receipt printed.
    "  receiptno     varchar(20)  NOT NULL,\n" +
    "  trandate      datetime         NULL,\n" +
    // Dispatch. All three may be blank independently: a recipient with no
    // phone is still worth printing.
    "  dispatch_to   varchar(100)     NULL,\n" +
    "  dispatch_tel  varchar(40)      NULL,\n" +
    "  dispatch_dest varchar(120)     NULL,\n" +
    // 1 is the ordinary case and is stored anyway: the difference between
    // "this was their first today" and "we never looked" is what makes the
    // row worth reporting on later.
    "  repeat_ord    int(11)      NOT NULL DEFAULT 1,\n" +
    "  repeat_who    varchar(100)     NULL,\n" +
    "  created       datetime         NULL,\n" +
    "  till          varchar(64)      NULL,\n" +
    "  staff         varchar(50)      NULL,\n" +
    "  PRIMARY KEY (receiptno),\n" +
    "  KEY ix_extras_day (trandate)\n" +
    ") ENGINE=InnoDB DEFAULT CHARSET=latin1"
};

const SETTINGS = [
  ["dispatch.enabled", "1",
    "master switch for the dispatch prompt"],
  ["dispatch.min_amount", "10000",
    "sale value at or above which the prompt appears, KES"],

  ["repeat.warn.enabled", "1",
    "warn when this customer already has a receipt today"],
  ["repeat.warn.mark_receipt", "1",
    "print the 'RECEIPT n OF n TODAY' line; off keeps the warning without the paper"],

  // The kill switch. If anything about the printed tail goes wrong in the
  // shop, this stops it across all eleven tills within 60 seconds and needs
  // no rebuild and no walk round.
  ["receipt.tail.enabled", "1",
    "print appended lines on the receipt at all - the kill switch"],
  // Measured, not guessed. rptposiflex.rpt carries a record SORT and a GROUP
  // on pos_details.description, so an appended row prints where its text
  // sorts to, not last. Rendering the real layout showed punctuation sorts
  // FIRST under Crystal's collation - a '~' prefix landed at record 1 - while
  // an alphabetic prefix lands after every product name. Hence ZZ, plus a
  // sequence digit added at print time so the lines keep their own order.
  ["receipt.tail.prefix", "ZZ",
    "sorts the appended lines below the last product; must stay alphabetic"],
  ["receipt.tail.width", "32",
    "characters before an appended line is truncated"],

  ["startermix.template", "JPOS280160",
    "the receipt a starter mix is scaled from"],
  ["startermix.tolerance", "50",
    "KES the scaled basket may miss the budget by"],
  ["startermix.min_budget", "1000",
    "refuse to build a mix below this"]
];

const dbIndex = process.argv.indexOf("--db");
const dbName = dbIndex !== -1 && process.argv[dbIndex + 1] ? process.argv[dbIndex + 1] : null;

const cfg = getMysqlConfig(dbName ? { database: dbName, connectTimeout: 15000 }
                                  : { connectTimeout: 15000 });
const conn = mysql.createConnection(toDriverOptions(cfg));

const q = (sql, args = []) =>
  new Promise((res, rej) => conn.query(sql, args, (e, r) => (e ? rej(e) : res(r))));

async function tableExists(name) {
  const rows = await q(
    "select table_name from information_schema.tables " +
    "where table_schema = database() and table_name = ?", [name]);
  return rows.length > 0;
}

async function columnExists(table, column) {
  const rows = await q(
    "select column_name from information_schema.columns " +
    "where table_schema = database() and table_name = ? and column_name = ?",
    [table, column]);
  return rows.length > 0;
}

// CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a
// column added to this script later would reach a fresh install and silently
// miss every database that already had the table. Same helper, same reason, as
// create-ticket-tables.js.
async function ensureColumn(table, column, definition, why) {
  if (!(await tableExists(table))) return;
  if (await columnExists(table, column)) {
    console.log("  " + table + "." + column + " already present - left alone.");
    return;
  }
  const sql = "ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition;
  console.log("  " + table + "." + column + " missing. " + why);
  console.log("    " + sql);
  if (APPLY) { await q(sql); console.log("    -> Added."); }
}

async function main() {
  console.log("");
  console.log("=== pos_extras ===");
  console.log("  database: " + describeConfigSource(cfg));
  console.log("  mode    : " + (APPLY ? "APPLY - changes will be written" : "dry run"));
  console.log("");

  for (const name of Object.keys(DDL)) {
    if (await tableExists(name)) {
      console.log(name + " already exists - left alone.");
    } else {
      console.log(name + " missing. Creating:");
      console.log(DDL[name].split("\n").map(l => "    " + l).join("\n"));
      if (APPLY) { await q(DDL[name]); console.log("  -> Created."); }
    }
  }

  console.log("\n-- columns added since the table was first created --");
  await ensureColumn("pos_extras", "repeat_who", "varchar(100) NULL",
    "the name the ordinal was counted against, so a later rename is visible.");

  console.log("\n-- settings --");
  const haveSettings = await tableExists("mw_settings");
  if (!haveSettings) {
    console.log("  mw_settings does not exist. Run create-ticket-tables.js first.");
  }
  for (const [key, value, why] of SETTINGS) {
    if (!haveSettings) {
      console.log("  " + key + " = " + value + "   (would seed; " + why + ")");
      continue;
    }
    const present = await q("select svalue from mw_settings where skey = ?", [key]);
    if (present.length) {
      console.log("  " + key + " = " + present[0].svalue + "   (already set, left alone)");
    } else {
      console.log("  " + key + " = " + value + "   (seeding; " + why + ")");
      if (APPLY) {
        await q("insert into mw_settings (skey, svalue, updated, staff) values (?, ?, now(), 'setup')",
          [key, value]);
      }
    }
  }

  console.log("");
  if (!APPLY) console.log("Dry run. Nothing written. Add --apply to make these changes.");
  console.log("");
}

main()
  .then(() => conn.end())
  .catch(e => { console.error("\n  Failed: " + e.message + "\n"); conn.end(); process.exit(1); });
