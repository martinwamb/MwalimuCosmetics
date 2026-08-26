/**
 * Mwalimu Cosmetics — the sale limits table.
 *
 * One row per product that may not be sold without limit: how much of it any
 * one customer may take in a day.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 *
 * Some lines are in high demand and short supply. Left alone, one buyer clears
 * the shelf on the morning a delivery lands and everybody else that week is
 * told there is none. FumasV5 has no concept of a maximum: si.specialprice and
 * si.specialqty are a volume DISCOUNT — buy more, pay less — which is the
 * opposite of what is needed here.
 *
 * ── Why a new table rather than a column on si ────────────────────────
 *
 * si is written by the vendor's own item screens and by the goods-received
 * path. Adding a column there means every one of those writers is a writer of
 * this feature too, and an item edited in FumasV5 could quietly drop a limit.
 * A table of our own has exactly two writers: FSaleLimits, and this script.
 *
 * ── Units ─────────────────────────────────────────────────────────────
 *
 * limit_qty is in SMALLEST UNITS — pieces — never in cartons or dozens.
 * mglobal.check_sale_limit runs every comparison through FumasV5's own
 * get_smallest_qty for the same reason check_inadequate_total_qty_pos does: a
 * cap of 24 pieces has to mean the same thing whether the cashier rings up 24
 * pieces or two cartons of twelve.
 *
 * ── Enforcement ───────────────────────────────────────────────────────
 *
 * Counted per customer per trading day, across every receipt and every till,
 * so it cannot be walked around by paying in two goes. A sale with no customer
 * on it — an unnamed walk-in, which is most of them — has nobody to count
 * against, so the cap applies to that basket alone. Enforced in FPOS at two
 * points: when a line is added, and again at payment where the customer is
 * finally known.
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");

const DDL = `
CREATE TABLE IF NOT EXISTS sale_limits (
  code       varchar(50)   NOT NULL,
  descr      varchar(255)      NULL,
  limit_qty  decimal(18,4) NOT NULL,
  active     tinyint(1)    NOT NULL DEFAULT 1,
  staff      varchar(50)       NULL,
  updated    datetime          NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=latin1
`;

const cfg = getMysqlConfig();
console.log(describeConfigSource(cfg));
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 30000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

async function main() {
  const existing = await q(
    "select table_name from information_schema.tables where table_schema = database() and table_name = 'sale_limits'");

  if (existing.length) {
    console.log("sale_limits already exists — left alone.");
  } else {
    console.log("sale_limits does not exist yet. It would be created as:");
    console.log(DDL.trim());
    if (APPLY) {
      await q(DDL);
      console.log("\nCreated.");
    }
  }

  // The whole point of a limit is that the till reads it on the way past, so
  // check the one function it depends on is actually there. Without
  // get_smallest_qty a limit would compare cartons against pieces.
  const fn = await q(
    "select routine_name from information_schema.routines " +
    "where routine_schema = database() and routine_name = 'get_smallest_qty'");
  console.log(fn.length
    ? "\nget_smallest_qty: present — quantities can be normalised to pieces."
    : "\nget_smallest_qty: MISSING. Limits would compare packing units against pieces. Do not enable this feature here.");

  if (existing.length || APPLY) {
    console.log("\n-- limits now in force --");
    const rows = await q(
      "select l.code, coalesce(nullif(trim(l.descr),''), i.descr) descr, l.limit_qty, l.active, l.staff, l.updated " +
      "from sale_limits l left join si i on i.CODE = l.code order by descr");
    if (rows.length) console.table(rows);
    else console.log("(none yet — set them in FumasV5 under Sale Limits)");
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
