/**
 * A starter mix, as an unposted draft on the till.
 *
 * Somebody who wants to open a small cosmetics shop comes in and asks what
 * KES 50,000 buys. Answering that by hand means ringing up nearly two hundred
 * lines, and the answer is different for every budget. So this takes one real
 * sale that already got the range right — the template — and rebuilds it at
 * whatever budget is asked for, as a draft the customer can be walked through
 * and the till can post if they say yes.
 *
 *   node starter-mix.js --budget 50000 --staff MARYANN
 *   node starter-mix.js --budget 20000 --staff MARYANN --apply
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply, and what it would
 * write is printed first.
 *
 * ── The two things that must not go wrong ──────────────────────────────
 *
 * 1. The receipt number. FumasV5 mints one in a single transaction:
 *
 *        update nauto set pos = pos + 1;
 *        select concat(upper(left(<usercode>,1)), ppos, pos) from nauto;
 *
 *    so JPOS280160 is J + POS + 280160. This does exactly that, in the same
 *    transaction as the inserts. Picking a number any other way — max()+1, a
 *    timestamp, anything — eventually hands a real customer a number this
 *    draft already used.
 *
 * 2. The shape of the row. Every field this does not deliberately change is
 *    copied from the template header that is actually in the database, rather
 *    than written out here from memory. A draft FumasV5 cannot resume is worse
 *    than no draft: the customer is standing there and the till says no.
 *
 * ── Scaling ─────────────────────────────────────────────────────────────
 *
 * The whole range is kept and the quantities move. A starter wants breadth —
 * one of many things to find out what sells — not six of a few. Every line
 * keeps at least one unit, so the shelf still looks like the template at any
 * budget; the arithmetic below then nudges quantities until the total lands on
 * the budget rather than near it.
 */

const mysql = require("mysql");
const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");

// ── Arguments ───────────────────────────────────────────────────────────

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (flag) => process.argv.includes(flag);

const BUDGET   = Number(arg("--budget", 50000));
// Case is preserved exactly as given. The shop has both MARYANN and maryann
// in its sales history for the same person, and writing a third variant
// would leave her draft looking like somebody else's. The receipt initial
// does not depend on it: nauto upper()s the first letter itself.
const STAFF    = String(arg("--staff", "")).trim();
const TEMPLATE = String(arg("--template", "JPOS280160")).trim().toUpperCase();
const TILL     = String(arg("--till", "MWALIMU-OFFICE")).trim();
const CUSTOMER = String(arg("--customer", "")).trim();
const PHONE    = String(arg("--phone", "")).trim();
const APPLY    = has("--apply");

// A rounding pass on 190 lines cannot always land exactly on the budget — the
// cheapest line is the smallest step it can take. Anything inside this is
// close enough to quote as the budget.
const TOLERANCE = 50;

const money = (n) => "KES " + Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 });

function fail(msg) {
  console.error("\n  " + msg + "\n");
  process.exit(1);
}

if (!Number.isFinite(BUDGET) || BUDGET < 1000) fail("--budget must be a number of at least 1000.");
if (!STAFF) fail("--staff is required, e.g. --staff MARYANN. It sets who the draft belongs to and the receipt's first letter.");

// ── Plumbing ────────────────────────────────────────────────────────────

const CONFIG = getMysqlConfig({ connectTimeout: 15000 });

const query = (conn, sql, args = []) =>
  new Promise((res, rej) => conn.query(sql, args, (e, r) => (e ? rej(e) : res(r))));

const begin    = (conn) => new Promise((res, rej) => conn.beginTransaction(e => (e ? rej(e) : res())));
const commit   = (conn) => new Promise((res, rej) => conn.commit(e => (e ? rej(e) : res())));
const rollback = (conn) => new Promise((res) => conn.rollback(() => res()));

/**
 * VAT carried by a VAT-inclusive line.
 *
 * The template's own figures give the rate away: 105.00 gross carries 14.48,
 * and 105 - 105/1.16 is 14.48. Read from the line rather than assumed, so a
 * zero-rated or exempt product stays that way.
 */
function vatOf(gross, taxable, inclusive, rate) {
  if (String(taxable).toUpperCase() !== "YES") return 0;
  if (String(inclusive).toUpperCase() !== "YES") return round2(gross * rate);
  return round2(gross - gross / (1 + rate));
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Infer the VAT rate from the template rather than hardcoding 16%.
 *
 * If the rate ever changes, a constant here would quietly keep pricing the old
 * one into every draft.
 */
function inferRate(lines) {
  for (const l of lines) {
    const gross = Number(l.total);
    const vat = Number(l.vat);
    if (gross > 0 && vat > 0 && String(l.inclusive).toUpperCase() === "YES") {
      // vat = gross - gross/(1+r)  =>  r = vat / (gross - vat)
      const r = vat / (gross - vat);
      if (r > 0.01 && r < 0.5) return Math.round(r * 1000) / 1000;
    }
  }
  return 0.16;
}

/**
 * Scale the basket to the budget, keeping every line.
 *
 * A flat multiply-and-round overshoots or undershoots by however the rounding
 * happened to fall, so afterwards quantities are nudged one unit at a time —
 * always on the line that moves the total closest to the budget — until it is
 * inside tolerance or nothing more can help. Cheap lines therefore do the fine
 * adjustment and expensive ones the coarse, which is what a person would do.
 */
function scaleBasket(lines, budget) {
  const templateTotal = lines.reduce((s, l) => s + Number(l.total), 0);
  if (templateTotal <= 0) fail("The template receipt has no value to scale from.");

  const factor = budget / templateTotal;

  const basket = lines.map(l => {
    const qty = Math.max(1, Math.round(Number(l.qty) * factor));
    return {
      src: l,
      price: Number(l.price),
      unitCost: Number(l.qty) > 0 ? Number(l.buy_cost) / Number(l.qty) : 0,
      qty
    };
  });

  const totalOf = () => basket.reduce((s, b) => s + b.qty * b.price, 0);

  // Nudge. Bounded hard: 190 lines and a budget in the tens of thousands
  // converge in a handful of passes, and a runaway loop against the shop's
  // database is not something to leave possible.
  for (let guard = 0; guard < 5000; guard++) {
    const total = totalOf();
    const gap = budget - total;
    if (Math.abs(gap) <= TOLERANCE) break;

    let best = null;
    for (const b of basket) {
      // Never below one: the range is the point of the mix.
      const step = gap > 0 ? 1 : (b.qty > 1 ? -1 : 0);
      if (step === 0) continue;
      const after = Math.abs(gap - step * b.price);
      if (after < Math.abs(gap) && (best === null || after < best.after)) {
        best = { b, step, after };
      }
    }
    if (!best) break;
    best.b.qty += best.step;
  }

  return { basket, templateTotal, factor };
}

// ── Main ────────────────────────────────────────────────────────────────

(async () => {
  console.log("\n=== Starter mix ===\n");
  console.log("  Template : " + TEMPLATE);
  console.log("  Budget   : " + money(BUDGET));
  console.log("  Staff    : " + STAFF);
  console.log("  Till     : " + TILL);
  console.log("  Database : " + describeConfigSource(CONFIG));
  console.log("  Mode     : " + (APPLY ? "APPLY — a draft will be written" : "dry run"));
  console.log("");

  const conn = mysql.createConnection(toDriverOptions(CONFIG));
  await new Promise((res, rej) => conn.connect(e => (e ? rej(e) : res())));

  try {
    const [header] = await query(conn,
      "select * from pos_header where receiptno = ?", [TEMPLATE]);
    if (!header) fail("No receipt " + TEMPLATE + " in pos_header.");

    const lines = await query(conn,
      "select * from pos_details where receiptno = ? order by posdid", [TEMPLATE]);
    if (!lines.length) fail("Receipt " + TEMPLATE + " has no lines.");

    const rate = inferRate(lines);
    const { basket, templateTotal, factor } = scaleBasket(lines, BUDGET);

    const total = basket.reduce((s, b) => s + b.qty * b.price, 0);
    const vat   = basket.reduce((s, b) =>
      s + vatOf(b.qty * b.price, b.src.taxable, b.src.inclusive, rate), 0);
    const cost  = basket.reduce((s, b) => s + b.qty * b.unitCost, 0);
    const units = basket.reduce((s, b) => s + b.qty, 0);

    console.log("  " + lines.length + " products, template total " + money(templateTotal) +
                ", scale x" + factor.toFixed(3) + ", VAT rate " + (rate * 100).toFixed(0) + "%\n");

    const width = Math.max(...basket.map(b => String(b.src.description || "").trim().length));
    for (const b of basket) {
      console.log("   " + String(b.src.description || "").trim().padEnd(Math.min(width, 40)).slice(0, 40) +
        String(b.qty).padStart(5) + " x " + String(b.price).padStart(7) +
        " = " + money(b.qty * b.price).padStart(12));
    }

    console.log("\n  " + "-".repeat(60));
    console.log("  Products      : " + basket.length);
    console.log("  Units         : " + units);
    console.log("  Total         : " + money(total) + "   (budget " + money(BUDGET) +
                ", out by " + money(Math.abs(BUDGET - total)) + ")");
    console.log("  VAT included  : " + money(vat));
    console.log("  Cost to shop  : " + money(cost));
    console.log("  Margin        : " + money(total - cost) +
                "  (" + (total > 0 ? ((total - cost) / total * 100).toFixed(1) : "0") + "%)");
    console.log("  " + "-".repeat(60) + "\n");

    // The floor is worth saying out loud. Keeping all 190 products means at
    // least one of each, and one of each already costs what it costs - so
    // below that figure this template simply cannot be used, and the honest
    // answer is a shorter list rather than a mix that quietly costs more than
    // the customer asked for.
    if (total > BUDGET + TOLERANCE) {
      const floor = basket.reduce((s, b) => s + b.price, 0);
      console.log("  ** This template cannot be built for " + money(BUDGET) + ". **");
      console.log("  One of each of its " + basket.length + " products already costs " +
                  money(floor) + ", which is the least it can be.");
      console.log("  For a smaller budget, use a template with fewer lines.\n");
    } else if (Math.abs(BUDGET - total) > TOLERANCE) {
      console.log("  Note: landed " + money(Math.abs(BUDGET - total)) +
                  " under the budget; no single line can close the gap.\n");
    }

    if (!APPLY) {
      console.log("  Dry run. Nothing written. Add --apply to create the draft.\n");
      conn.end();
      return;
    }

    // ── The write ───────────────────────────────────────────────────────
    //
    // One transaction: mint the number the way FumasV5 mints it, then the
    // header, then the lines. If any part fails the number is given back, so a
    // failed run does not burn a receipt number or leave a header with no
    // lines behind it.
    await begin(conn);
    try {
      await query(conn, "update nauto set pos = pos + 1");
      const [minted] = await query(conn,
        "select concat(upper(left(?,1)), ppos, pos) as receiptno from nauto", [STAFF]);
      const receiptno = minted && minted.receiptno;
      if (!receiptno) throw new Error("nauto did not yield a receipt number");

      const clash = await query(conn,
        "select receiptno from pos_header where receiptno = ?", [receiptno]);
      if (clash.length) throw new Error("Receipt " + receiptno + " already exists — nauto is behind the data");

      // Start from the template row so every column this does not name keeps
      // whatever the shop actually uses, then override what must differ.
      const row = Object.assign({}, header);
      delete row.posid;

      row.receiptno = receiptno;
      row.posted    = 0;               // a draft, and the whole point
      row.amount    = Math.ceil(total);
      row.paid      = 0;               // nobody has paid yet
      row.changee   = 0;
      row.cash = 0; row.mpesa = 0; row.creditcard = 0; row.cheque = 0;
      row.tyype     = "";              // no payment method until it is posted
      row.ref       = "";
      row.tax       = round2(vat);
      row.staff     = STAFF;
      row.pstaff    = STAFF;
      row.pos       = TILL;
      row.arname    = CUSTOMER;
      row.arcode    = PHONE;
      row.notes     = "Starter mix " + money(BUDGET);
      row.details   = "";
      row.trandate  = new Date();
      row.posdate   = new Date();
      row.reprint   = 0;
      row.amt_word  = "";
      row.is_return = 0;
      row.cu_invoice_number = "";

      const cols = Object.keys(row);
      await query(conn,
        "insert into pos_header (" + cols.map(c => "`" + c + "`").join(",") + ") values (" +
        cols.map(() => "?").join(",") + ")",
        cols.map(c => row[c]));

      for (const b of basket) {
        const line = Object.assign({}, b.src);
        delete line.posdid;

        const gross = round2(b.qty * b.price);
        line.receiptno = receiptno;
        line.qty       = b.qty;
        line.total     = gross;
        line.vat       = vatOf(gross, line.taxable, line.inclusive, rate);
        line.buy_cost  = round2(b.qty * b.unitCost);
        line.posted    = 0;

        const lcols = Object.keys(line);
        await query(conn,
          "insert into pos_details (" + lcols.map(c => "`" + c + "`").join(",") + ") values (" +
          lcols.map(() => "?").join(",") + ")",
          lcols.map(c => line[c]));
      }

      await commit(conn);
      console.log("  Draft created: " + receiptno);
      console.log("  Open it on the till with Resume, under " + STAFF + ".\n");
    } catch (e) {
      await rollback(conn);
      throw e;
    }

    conn.end();
  } catch (e) {
    try { conn.end(); } catch (_) {}
    fail("Failed: " + e.message);
  }
})();
