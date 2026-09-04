/**
 * Mwalimu Cosmetics — the sale limits table.
 *
 * One row per product that may not be sold without limit: how much of it any
 * one customer may take in a day, and how much of it any one SELLER may move
 * in a day.
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
 * ── Enforcement: the customer ─────────────────────────────────────────
 *
 * Counted per customer per trading day, across every receipt and every till,
 * so it cannot be walked around by paying in two goes. A sale with no customer
 * on it — an unnamed walk-in, which is most of them — has nobody to count
 * against, so the cap applies to that basket alone. Enforced in FPOS at two
 * points: when a line is added, and again at payment where the customer is
 * finally known.
 *
 * ── Enforcement: the seller ───────────────────────────────────────────
 *
 * The customer cap assumes the person typing the customer in is not the person
 * being got around. They are. The cashier types both the name and the phone
 * number, so a seller who wants to keep serving the same buyer types a
 * different one and the count starts again at zero.
 *
 * seller_qty caps the OTHER side of the counter: how much of one product one
 * member of staff may sell in a day, whatever names went on the receipts.
 * Counted against pos_header.staff, across every receipt and every till —
 * measured on this shop, staff move between as many as six machines in a week,
 * so a per-till count would be no count at all.
 *
 * NULL means "follow the shop multiple", mw_settings salelimit.seller.multiple,
 * which is 3 by default: a seller may move three customers worth of a limited
 * line in a day. Set it to 0 to switch seller caps off everywhere without
 * touching a single product row.
 *
 * This does not make the behaviour impossible — two sellers working together
 * still defeat it — but it makes it cost something, and FSellerActivity makes
 * what is left of it visible.
 *
 * Dry run by default. Pass --apply to write.
 * Pass --index too for the two indexes FSellerActivity needs. They rebuild
 * tables of over a million rows. Out of trading hours only.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");
const INDEX = process.argv.includes("--index");

// How many customer-limits one seller may move in a day, when a product does
// not name its own seller_qty. Three is what the shop asked for; it lives in
// mw_settings rather than in a constant here so it can be changed from the
// admin panel without a new build going round eleven tills.
const DEFAULT_SELLER_MULTIPLE = "3";
const MULTIPLE_KEY = "salelimit.seller.multiple";

const DDL = `
CREATE TABLE IF NOT EXISTS sale_limits (
  code       varchar(50)   NOT NULL,
  descr      varchar(255)      NULL,
  limit_qty  decimal(18,4) NOT NULL,
  seller_qty decimal(18,4)     NULL,
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
    conn.query({ sql, timeout: 600000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

// Adding a column to a table that may or may not already have it. MySQL 5.1
// has no "add column if not exists", and catching the duplicate-column error
// would also swallow the errors worth seeing, so it is asked first.
async function ensureColumn(table, column, definition) {
  const found = await q(
    "select column_name from information_schema.columns " +
    "where table_schema = database() and table_name = ? and column_name = ?",
    [table, column]);

  if (found.length) {
    console.log(table + "." + column + ": present — left alone.");
    return;
  }
  console.log(table + "." + column + ": MISSING. Would run:");
  console.log("  alter table " + table + " add column " + column + " " + definition);
  if (APPLY) {
    await q("alter table " + table + " add column " + column + " " + definition);
    console.log("  added.");
  }
}

// Never overwritten. Somebody who has moved the shop multiple to 4 has done so
// deliberately, and a re-run of a migration script is not a reason to undo it.
async function ensureSetting(key, value) {
  const found = await q("select svalue from mw_settings where skey = ?", [key]);
  if (found.length) {
    console.log("mw_settings " + key + ": already " + found[0].svalue + " — left alone.");
    return;
  }
  console.log("mw_settings " + key + ": MISSING. Would insert " + value + ".");
  if (APPLY) {
    await q("insert into mw_settings (skey, svalue, staff, updated) values (?,?,?,now())",
      [key, value, "setup"]);
    console.log("  inserted.");
  }
}

// The two indexes FSellerActivity needs, and neither of them is cheap to add.
//
//   pos_idx_arcode   answers "had this phone number ever bought here before
//                    today?". pos_idx leads on receiptno, so without this the
//                    question costs about 111,000 row reads FOR EVERY ROW of
//                    output — measured, not guessed.
//
//   sa_idx_adate     the day's refusals and overrides. systemaudit has nothing
//                    but its primary key, so reading one day out of it is a
//                    scan of 1.7M rows: 5.2 seconds, measured, while ten tills
//                    are trying to sell.
//
// Both rebuild a table of more than a million rows and hold it while they do,
// so they are behind their own flag and belong out of trading hours. The screen
// checks for them and simply leaves those columns out until they exist, so the
// rest of the feature does not wait on this.
const INDEXES = [
  ["pos_header", "pos_idx_arcode", "(arcode, trandate)"],
  ["systemaudit", "sa_idx_adate", "(adate)"],
];

async function ensureIndexes() {
  for (const [table, name, columns] of INDEXES) {
    const found = await q("show index from " + table + " where Key_name = ?", [name]);
    if (found.length) {
      console.log(table + "." + name + ": present — left alone.");
      continue;
    }
    if (!INDEX) {
      console.log(table + "." + name + ": MISSING.");
      console.log("  Not added: it rebuilds a table of over a million rows.");
      console.log("  Re-run with --apply --index, out of trading hours.");
      continue;
    }
    console.log(table + "." + name + ": MISSING. Would run:");
    console.log("  alter table " + table + " add index " + name + " " + columns);
    if (APPLY) {
      console.log("  building — minutes, on a table this size...");
      await q("alter table " + table + " add index " + name + " " + columns);
      console.log("  added.");
    }
  }
}

async function main() {
  const existing = await q(
    "select table_name from information_schema.tables " +
    "where table_schema = database() and table_name = 'sale_limits'");

  if (existing.length) {
    console.log("sale_limits already exists — left alone.");
    // Created before seller caps were a thing, so the column may be absent.
    await ensureColumn("sale_limits", "seller_qty", "decimal(18,4) null after limit_qty");
  } else {
    console.log("sale_limits does not exist yet. It would be created as:");
    console.log(DDL.trim());
    if (APPLY) {
      await q(DDL);
      console.log("\nCreated.");
    }
  }

  console.log("");
  await ensureSetting(MULTIPLE_KEY, DEFAULT_SELLER_MULTIPLE);
  await ensureIndexes();

  // The whole point of a limit is that the till reads it on the way past, so
  // check the one function it depends on is actually there. Without
  // get_smallest_qty a limit would compare cartons against pieces.
  const fn = await q(
    "select routine_name from information_schema.routines " +
    "where routine_schema = database() and routine_name = 'get_smallest_qty'");
  console.log(fn.length
    ? "\nget_smallest_qty: present — quantities can be normalised to pieces."
    : "\nget_smallest_qty: MISSING. Limits would compare packing units against " +
      "pieces. Do not enable this feature here.");

  if (existing.length || APPLY) {
    const setting = await q("select svalue from mw_settings where skey = ?", [MULTIPLE_KEY]);
    const multiple = Number(setting.length ? setting[0].svalue : DEFAULT_SELLER_MULTIPLE);

    console.log("\n-- limits now in force (shop multiple: " + multiple + "x) --");

    // seller_qty is selected only when the column exists, so a dry run against
    // a database that has not been migrated yet still prints the customer
    // limits rather than failing on an unknown column.
    const hasSeller = (await q(
      "select column_name from information_schema.columns " +
      "where table_schema = database() and table_name = 'sale_limits' " +
      "and column_name = 'seller_qty'")).length > 0;

    const rows = await q(
      "select l.code, coalesce(nullif(trim(l.descr),''), i.descr) descr, l.limit_qty, " +
      (hasSeller ? "l.seller_qty, " : "null seller_qty, ") +
      "l.active, l.staff, l.updated " +
      "from sale_limits l left join si i on i.CODE = l.code order by descr");

    if (rows.length) {
      console.table(rows.map(function (r) {
        const own = r.seller_qty === null || r.seller_qty === undefined;
        return {
          code: r.code,
          descr: r.descr,
          per_customer: Number(r.limit_qty),
          per_seller: own
            ? Number(r.limit_qty) * multiple + " (" + multiple + "x)"
            : Number(r.seller_qty) + " (set)",
          active: r.active,
          staff: r.staff,
          updated: r.updated,
        };
      }));
    } else {
      console.log("(none yet — set them in FumasV5 under Sale Limits)");
    }
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
