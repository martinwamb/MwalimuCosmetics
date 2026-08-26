/**
 * Mwalimu Cosmetics — copy a real posted sale into the test database.
 *
 * Ticketing is tested against actual receipts rather than invented ones. A
 * hand-made fixture has whatever shape the developer imagined; a real sale has
 * the shape the shop actually produces — blank customer names, service lines
 * mixed in with stock, quantities in cartons, descriptions with punctuation in
 * them. Those are the cases a slip has to survive.
 *
 * Reads from mwalimuinvest, writes to mwalimuinvest_test, and refuses to run
 * if the target is not a _test database. The source is only ever read.
 *
 * Usage:
 *   MWALIMU_DB_NAME=mwalimuinvest_test node tickets/copy-receipt.js NPOS276317 JPOS276318
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./../db-config.js");

const APPLY = process.argv.includes("--apply");
const SOURCE = "mwalimuinvest";
const RECEIPTS = process.argv.slice(2).filter(a => !a.startsWith("--"));

if (!RECEIPTS.length) {
  console.error("Give at least one receipt number.");
  process.exit(1);
}

const cfg = getMysqlConfig();
if (!/_test$/.test(cfg.database)) {
  console.error("REFUSING: target database is '" + cfg.database + "', which is not a _test database.");
  process.exit(1);
}

console.log(describeConfigSource(cfg));
console.log("Source: " + SOURCE + "   Target: " + cfg.database);
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 60000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

async function main() {
  for (const r of RECEIPTS) {
    const head = await q(
      "select receiptno, amount, arname, posted, posdate from " + SOURCE + ".pos_header where receiptno = ?", [r]);
    if (!head.length) {
      console.log(r + ": NOT FOUND in " + SOURCE + " — skipped.");
      continue;
    }
    const det = await q(
      "select count(*) n from " + SOURCE + ".pos_details where receiptno = ?", [r]);
    const stock = await q(
      "select count(*) n from " + SOURCE + ".pos_details where receiptno = ? and type = 'Stocks'", [r]);

    console.log(r + ": amount=" + head[0].amount +
      "  lines=" + det[0].n + " (" + stock[0].n + " stock)" +
      "  name=" + (head[0].arname || "(blank)") +
      "  posted=" + head[0].posted);

    if (!APPLY) continue;

    // Replace rather than merge. A half-copied receipt left over from an
    // earlier run would give the ticket a line count that matches nothing.
    await q("delete from pos_details where receiptno = ?", [r]);
    await q("delete from pos_header where receiptno = ?", [r]);
    await q("insert into pos_header select * from " + SOURCE + ".pos_header where receiptno = ?", [r]);
    await q("insert into pos_details select * from " + SOURCE + ".pos_details where receiptno = ?", [r]);

    // Any ticket from a previous run has to go too, or Issue will simply hand
    // back the old one and the test proves nothing.
    await q("delete from tickets where receiptno = ?", [r]);

    const check = await q("select count(*) n from pos_details where receiptno = ?", [r]);
    console.log("   -> copied, " + check[0].n + " detail rows, any old ticket cleared.");
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
