/**
 * Mwalimu Cosmetics — the evening restock sheet.
 *
 * Every evening, what is selling fast and about to run out, how much of it to
 * order, and who to order it from. A short sheet on the Epson for the things
 * that cost the most to be without, and the whole list as a PDF on Telegram so
 * the long tail does not cost paper.
 *
 * ── Why this is a forecast and not a report ───────────────────────────
 *
 * The obvious way to write this is to read a reorder level off each product.
 * There are none: si.minlevel is set on 3 products out of 7,488 and maxlevel on
 * 8. So "running low" has to be worked out from how fast the thing actually
 * sells, which makes the forecast the feature rather than an ornament on it.
 *
 * ── How much forecasting is honest here ───────────────────────────────
 *
 * Sales start on 2024-01-02, so there are exactly two prior years. That is
 * enough to say something about the shop and nothing about a single product: two
 * observations of one calendar week for one line is noise, and a per-product
 * seasonal model would be fitting that noise and calling it insight.
 *
 * So the two halves are taken from different places. The LEVEL is per product,
 * where there is plenty of data — a damped blend of the last 28 and 84 days. The
 * SHAPE is shop-wide, where there is enough volume to be stable, and it is
 * applied only when both prior years agree about the direction. December beat
 * November by 21% in 2024 and 29% in 2025, so the shape is real.
 *
 * ── What it cannot know ───────────────────────────────────────────────
 *
 * The shop does not raise purchase orders: lpo has two rows ever and not one
 * delivery in the last year references one. So nothing here can subtract what is
 * already on its way. Every line therefore carries the date and size of its last
 * delivery, and the sheet says so in as many words, because a reorder report
 * that quietly double-orders is worse than none.
 *
 * ── Two things that make it fast ──────────────────────────────────────
 *
 * NEVER filter stran by loc. The column is in no index, so it costs 2,482ms per
 * product against 71ms without it, and grouping the whole table with that filter
 * took 307 SECONDS. The shop is single-location — SHOP everywhere across
 * pos_header, sq, and all but one of 56,996 GRNs — so the filter buys nothing.
 *
 * And quantities are converted to smallest units HERE rather than by calling
 * get_smallest_qty in SQL. The function is one row lookup in pu per call; doing
 * it per row of an 84-day pull is millions of them. pu is a few dozen rows, so
 * it is loaded once and the multiplication happens in memory. Same arithmetic,
 * seconds instead of minutes.
 *
 * Dry run by default: works everything out, writes the PDFs, prints nothing and
 * sends nothing. Pass --apply to print and send.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const mysql = require("mysql");
const PDFDocument = require("pdfkit");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");
const OUT_DIR = process.env.RESTOCK_OUT || path.join(__dirname, "restock");

// ── What counts, and how much of it ───────────────────────────────────

// Fast moving: it has to sell steadily, not once. The "separate days" half is
// what rejects a single bulk sale that looks fast and will not happen again.
const FAST_MIN_PER_DAY = 0.5;
const FAST_MIN_DAYS = 14;
const FAST_WINDOW = 56;

// The level: recent-weighted so a real change shows, damped so one busy week
// does not become the plan.
const W_RECENT = 0.7;
const RECENT_DAYS = 28;
const BASE_DAYS = 84;

// Marked as rising on the sheet, not multiplied up. A line that has taken off
// deserves a human glance more than it deserves a bigger number.
const TREND_FLAG = 1.3;

// How long the stock has to last: the supplier's own rhythm plus a week, since
// nobody is ordering daily.
const REVIEW_DAYS = 7;
const LEAD_MIN = 3;
const LEAD_DEFAULT = 7;
const LEAD_MAX = 14;

// 1.65 is a 95% service level. Erratic lines get more cover than steady ones,
// which is the only reason to hold safety stock at all.
const Z = 1.65;
const SD_WEEKS = 12;

// The paper is a top slice; the PDF is everything.
const PRINT_LINES = 40;
// A UNC path, built from character codes rather than written as a literal:
// every shell between here and the file eats backslashes, and a half-eaten
// one becomes the printer name "10.10.10.12EPSON L3250 Series", which fails
// with an error that says nothing about why.
const UNC = String.fromCharCode(92, 92);
const SEP = String.fromCharCode(92);
const PRINTER = process.env.RESTOCK_PRINTER ||
  UNC + "10.10.10.12" + SEP + "EPSON L3250 Series";

const cfg = getMysqlConfig();
const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 600000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

// MySQL hands back a DATE as local midnight; toISOString would then read it
// as the day before, because the server is UTC+3. Every date therefore comes
// out of SQL already formatted, and the only Dates built here are from those
// strings, which parse as UTC midnight and round-trip cleanly.
const day = (d) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// ── Reading the shop ──────────────────────────────────────────────────

// What get_smallest_qty does, in memory: a quantity times its packing factor,
// defaulting to 1 for a unit nobody has defined.
async function loadFactors() {
  const rows = await q("select code, factor from pu");
  const f = new Map();
  for (const r of rows) {
    const v = Number(r.factor);
    f.set(String(r.code || "").trim().toUpperCase(), v > 0 ? v : 1);
  }
  return (qty, unit) => {
    const k = String(unit || "").trim().toUpperCase();
    return Number(qty) * (f.has(k) ? f.get(k) : 1);
  };
}

// One pull of every sale of every product over the base window, by day. Roughly
// 70,000 rows, which is nothing to move and lets every window, every weekly
// bucket and the days-sold count be worked out from the same data in memory
// rather than from four more trips to a database ten tills are using.
async function loadSales(smallest) {
  const rows = await q(
    "select d.code code, date_format(h.trandate, '%Y-%m-%d') d, sum(d.qty) qty, d.nunit nunit " +
    "from pos_header h join pos_details d on d.receiptno = h.receiptno " +
    "where h.posted = 1 and (h.is_return = 0 or h.is_return is null) " +
    "and d.type = 'Stocks' and h.trandate >= curdate() - interval ? day " +
    "group by d.code, date_format(h.trandate, '%Y-%m-%d'), d.nunit", [BASE_DAYS]);

  const byCode = new Map();
  for (const r of rows) {
    const code = String(r.code);
    if (!byCode.has(code)) byCode.set(code, new Map());
    const days = byCode.get(code);
    const key = r.d;
    days.set(key, (days.get(key) || 0) + smallest(r.qty, r.nunit));
  }
  return byCode;
}

// The app's own rule, and it matters that it is the app's: sq is a cache
// covering 3,320 of 7,488 active items, and the other 4,176 have no row at all.
// mglobal.get_available_qty reads sq first and falls back to the stran ledger,
// so the figure on the paper is the figure the till sells against.
async function loadStock(candidates) {
  const stock = new Map();
  for (const r of await q("select CODE code, sum(quantity) oh from sq where loc = 'SHOP' group by CODE")) {
    stock.set(String(r.code), Number(r.oh));
  }

  const missing = candidates.filter(c => !stock.has(c));
  // Batched, and with no loc filter — see the note at the top of this file.
  for (let i = 0; i < missing.length; i += 200) {
    const batch = missing.slice(i, i + 200);
    const rows = await q(
      "select code, sum(if(ts = '+', tqty, tqty * -1)) oh from stran " +
      "where code in (" + batch.map(() => "?").join(",") + ") group by code", batch);
    for (const r of rows) stock.set(String(r.code), Number(r.oh));
  }
  return stock;
}

// Who to call, and what they last sent. Roughly half of all products have had
// more than one supplier, so "whoever delivered it last" is the rule. OPENING is
// not a supplier, it is how opening stock was booked in.
async function loadSuppliers() {
  const rows = await q(
    "select d.code code, g.scode scode, g.sname sname, date_format(g.ddate, '%Y-%m-%d') ddate, " +
    "sum(d.qty) qty, max(d.pu) pu " +
    "from grn g join grn_d d on d.no = g.no " +
    "join (select d2.code code, max(g2.ddate) mx from grn g2 " +
    "      join grn_d d2 on d2.no = g2.no " +
    "      where g2.posted = 1 and g2.scode <> 'OPENING' group by d2.code) last " +
    "  on last.code = d.code and last.mx = g.ddate " +
    "where g.posted = 1 and g.scode <> 'OPENING' " +
    "group by d.code, g.scode, g.sname, g.ddate");

  const sup = new Map();
  for (const r of rows) sup.set(String(r.code), {
    scode: r.scode, sname: (r.sname || r.scode || "").trim(),
    last: r.ddate || null, lastQty: Number(r.qty) || 0,
    pu: (r.pu || "").trim(),
  });
  return sup;
}

// How long the stock has to last before more can arrive.
//
// The database cannot tell us a lead time: nobody raises purchase orders, so
// there is no gap between ordering and receiving recorded anywhere. The nearest
// honest proxy is how often a supplier actually turns up, and the trap is that
// for the long tail of suppliers that is not a lead time at all — it is "they
// rarely come". Taking the mean gap gave 79 days for one supplier, a horizon of
// 86 days, and a recommendation to order eighty times the daily sale.
//
// So: the MEDIAN gap between consecutive deliveries, which one six-month silence
// cannot drag upwards, and then clamped. The floor stops a daily supplier from
// producing a horizon shorter than it takes to notice the sheet; the ceiling is
// the real judgement — beyond about three weeks of cover, ordering more is a
// decision about cash and shelf space, not about running out, and this report
// has no business making it.
async function loadLeadTimes() {
  const rows = await q(
    "select scode, date_format(ddate, '%Y-%m-%d') d from grn " +
    "where posted = 1 and scode <> 'OPENING' and ddate >= curdate() - interval 365 day " +
    "group by scode, ddate order by scode, ddate");

  const byCode = new Map();
  for (const r of rows) {
    const k = String(r.scode);
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(new Date(r.d).getTime());
  }

  const lead = new Map();
  for (const [code, times] of byCode) {
    if (times.length < 2) { lead.set(code, LEAD_DEFAULT); continue; }
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 86400000);
    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
    lead.set(code, Math.min(LEAD_MAX, Math.max(LEAD_MIN, Math.round(median))));
  }
  return lead;
}

async function loadItems() {
  const rows = await q("select CODE code, descr, PRICE price, sunit from si where active = 1");
  const items = new Map();
  for (const r of rows) items.set(String(r.code), {
    descr: (r.descr || "").trim(), price: Number(r.price) || 0, sunit: (r.sunit || "").trim(),
  });
  return items;
}

// Shop-wide takings by day, for the seasonal shape.
async function loadDailyTotals() {
  const rows = await q(
    "select date_format(trandate, '%Y-%m-%d') d, sum(amount) v from pos_header " +
    "where posted = 1 and (is_return = 0 or is_return is null) group by date_format(trandate, '%Y-%m-%d')");
  const t = new Map();
  for (const r of rows) t.set(r.d, Number(r.v) || 0);
  return t;
}

// ── The forecast ──────────────────────────────────────────────────────

// Does the shop as a whole rise or fall going into the next few weeks?
//
// Worked out from the two prior years: what was taken in the window ahead,
// against the 28 days before it. Applied ONLY when both years agree about the
// direction — one year saying "up 20%" and the other "down 15%" is not a season,
// it is two ordinary years, and averaging them into 1.02 would dress up noise as
// a decision. Returns 1 and a reason when it will not commit.
function seasonalFactor(totals, today, horizon) {
  const sum = (from, days) => {
    let t = 0;
    for (let i = 0; i < days; i++) t += totals.get(day(addDays(from, i))) || 0;
    return t;
  };

  const ratios = [];
  for (const back of [365, 730]) {
    const then = addDays(today, -back);
    const ahead = sum(then, horizon);
    const before = sum(addDays(then, -RECENT_DAYS), RECENT_DAYS);
    if (before <= 0 || ahead <= 0) continue;
    ratios.push((ahead / horizon) / (before / RECENT_DAYS));
  }

  if (ratios.length < 2) return { factor: 1, why: "only one prior year to go on" };
  const up = ratios.every(r => r > 1.05);
  const down = ratios.every(r => r < 0.95);
  if (!up && !down) return { factor: 1, why: "the two prior years disagree" };

  const f = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return {
    factor: f,
    why: (f > 1 ? "up " : "down ") + Math.round(Math.abs(f - 1) * 100) + "% at this time of year, both years",
  };
}

function stdev(xs) {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// Everything about one product, from its sales, its stock and its supplier.
function assess(code, days, today, ctx) {
  // Counted from YESTERDAY back. Today is half a trading day at 7pm and would
  // drag every rate down by however much of the evening is still to come.
  const window = (n) => {
    let t = 0, sold = 0;
    for (let i = 0; i < n; i++) {
      const v = days.get(day(addDays(today, -i - 1)));
      if (v) { t += v; sold++; }
    }
    return { qty: t, days: sold };
  };

  const w56 = window(FAST_WINDOW);
  if (w56.qty / FAST_WINDOW < FAST_MIN_PER_DAY || w56.days < FAST_MIN_DAYS) return null;

  const r28 = window(RECENT_DAYS).qty / RECENT_DAYS;
  const r84 = window(BASE_DAYS).qty / BASE_DAYS;
  const base = W_RECENT * r28 + (1 - W_RECENT) * r84;
  if (base <= 0) return null;

  const onHand = ctx.stock.has(code) ? ctx.stock.get(code) : null;
  if (onHand === null) return null;

  const sup = ctx.suppliers.get(code) || null;
  const lead = sup && ctx.lead.has(sup.scode) ? ctx.lead.get(sup.scode) : LEAD_DEFAULT;
  const horizon = lead + REVIEW_DAYS;

  // Weekly buckets, for how erratic this line is.
  const weeks = [];
  for (let w = 0; w < SD_WEEKS; w++) {
    let t = 0;
    for (let i = 0; i < 7; i++) t += days.get(day(addDays(today, -(w * 7 + i + 1)))) || 0;
    weeks.push(t);
  }
  const safety = Z * (stdev(weeks) / Math.sqrt(7)) * Math.sqrt(horizon);

  const demand = base * ctx.season.factor * horizon;
  const target = demand + safety;
  const order = Math.max(0, Math.ceil(target - onHand));
  const cover = base > 0 ? onHand / (base * ctx.season.factor) : 0;

  const item = ctx.items.get(code) || { descr: code, price: 0, sunit: "" };

  // What it costs to be out: the days we expect to be short, times what a day
  // of this line is worth. It is what ranks the sheet, because a page can only
  // hold so much and this is the half that matters.
  const short = Math.max(0, horizon - cover);
  const atRisk = short * base * ctx.season.factor * item.price;

  return {
    code, descr: item.descr || code, price: item.price, sunit: item.sunit,
    onHand, base, r28, r84, cover, horizon, lead, safety, order, atRisk,
    rising: r84 > 0 && r28 / r84 >= TREND_FLAG,
    sname: sup ? sup.sname : "(no supplier on record)",
    scode: sup ? sup.scode : "",
    lastDelivery: sup ? sup.last : null,
    lastQty: sup ? sup.lastQty : 0,
    pu: sup ? sup.pu : "",
  };
}

// ── The sheet ─────────────────────────────────────────────────────────
//
// Minimalist on purpose: one typeface, no rules, no shading, no boxes. This is
// read standing up, next to a shelf, by somebody deciding what to phone for. The
// only emphasis in the whole document is the quantity to order, because that is
// the one number being acted on.
//
// Two shapes, for two jobs. The PAPER sheet is a flat list in urgency order with
// the supplier alongside — forty urgent lines belong to twenty-six different
// suppliers, so grouping them there would produce a page of headings with one
// line under each. The PDF is grouped by supplier, because that is the document
// you sit down with to actually place orders.

const INK = "#111111";
const FADE = "#8a8a8a";
const M = 42;
const BOTTOM = 780;

const FLAT = { name: 205, sup: 340, have: 395, days: 437, order: 492, last: 497 };
const GROUPED = { name: 250, sup: 0, have: 330, days: 385, order: 447, last: 453 };

const n0 = (v) => Math.round(v).toLocaleString("en-GB");
const n1 = (v) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));
const shortDate = (s) => {
  if (!s) return "\u2014";
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return s.slice(8) + " " + mo[Number(s.slice(5, 7)) - 1];
};

function heading(doc, c, row, flat) {
  doc.fillColor(FADE).fontSize(7).font("Helvetica");
  doc.text("PRODUCT", M, row);
  if (flat) doc.text("SUPPLIER", c.name + 8, row);
  doc.text("HAVE", 0, row, { width: c.have, align: "right" });
  doc.text("DAYS", 0, row, { width: c.days, align: "right" });
  doc.text("ORDER", 0, row, { width: c.order, align: "right" });
  doc.text("LAST IN", c.last + 8, row);
  return row + 13;
}

function line(doc, c, r, y, flat) {
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  doc.text(r.descr + (r.rising ? "  \u2191" : ""), M, y,
    { width: c.name - M - 6, lineBreak: false, ellipsis: true });
  if (flat) {
    doc.fillColor(FADE).fontSize(8)
      .text(r.sname, c.name + 8, y + 0.5, { width: c.sup - c.name - 14, lineBreak: false, ellipsis: true });
    doc.fillColor(INK).fontSize(9);
  }
  doc.text(n0(r.onHand), 0, y, { width: c.have, align: "right" });
  doc.text(r.cover >= 100 ? "99+" : n1(r.cover), 0, y, { width: c.days, align: "right" });
  doc.font("Helvetica-Bold").text(n0(r.order), 0, y, { width: c.order, align: "right" });
  doc.font("Helvetica").fillColor(FADE).fontSize(8)
    .text(shortDate(r.lastDelivery), c.last + 8, y + 0.5, { width: 56, lineBreak: false });
  return y + 12.5;
}

function render(file, title, rows, season, generatedAt, note, flat) {
  const c = flat ? FLAT : GROUPED;
  // Nothing on this network can render a PDF back to an image, so there is no
  // way to look at what was produced except to print it. RESTOCK_UNCOMPRESSED
  // leaves the text uncompressed inside the file, where grep can read it.
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true,
    compress: !process.env.RESTOCK_UNCOMPRESSED });
  const done = new Promise(res => doc.on("end", res));
  doc.pipe(fs.createWriteStream(file));

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(title, M, M);
  doc.font("Helvetica").fontSize(8.5).fillColor(FADE).text(generatedAt, M, doc.y + 4);
  doc.text("Demand " + (season.factor === 1 ? "as recent weeks"
    : Math.round(season.factor * 100) + "% of recent weeks") + " \u2014 " + season.why, M, doc.y + 1);
  if (note) doc.text(note, M, doc.y + 1);

  let y = doc.y + 14;
  let supplier = null;

  if (flat) y = heading(doc, c, y, true);

  for (const r of rows) {
    if (y > BOTTOM) {
      doc.addPage(); y = M; supplier = null;
      if (flat) y = heading(doc, c, y, true);
    }
    if (!flat && r.sname !== supplier) {
      supplier = r.sname;
      if (y + 40 > BOTTOM) { doc.addPage(); y = M; }
      else y += 7;
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(supplier, M, y);
      y = heading(doc, c, y + 13, false);
    }
    y = line(doc, c, r, y, flat);
  }

  if (!rows.length) {
    doc.font("Helvetica").fontSize(10).fillColor(INK)
      .text("Nothing needs ordering tonight.", M, y);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7).fillColor(FADE);
    doc.text("DAYS = how long the stock lasts at the forecast rate.   " +
      "\u2191 = selling faster than its 12-week average.   " +
      "Page " + (i + 1) + " of " + range.count, M, 806, { width: 515, lineBreak: false });
  }

  doc.end();
  return done;
}

// ── Getting it out ────────────────────────────────────────────────────

// The Epson is plugged into another machine, and it has to stay there.
//
// This PC is the only one with node, the database and the internet, so it does
// the work — but it has no Epson driver. Connecting it to the shared printer
// makes Windows fetch one over point-and-print, and that hangs a scheduled task
// outright: measured here, rundll32 printui simply never returned, because
// there is nobody logged in to answer the prompt it puts up.
//
// So the two machines each do what they are equipped for. This one writes the
// sheet into a drop folder on the PC the printer is plugged into. A small task
// over there prints it locally, where the driver already is, and files it away.
function handOff(file) {
  const drop = process.env.RESTOCK_DROP ||
    UNC + "10.10.10.12" + SEP + "C$" + SEP + "Mwalimu" + SEP + "restock-in";
  const host = drop.split(SEP).filter(Boolean)[0];

  // A scheduled task has no drive letters and no connections of its own.
  try {
    execFileSync("cmd", ["/c", "net use " + UNC + host + SEP +
      "C$ /user:mwalimuadmin MwalimuAdmin2026"], { stdio: "ignore" });
  } catch (e) { /* already connected, or on the printer PC itself */ }

  try {
    fs.mkdirSync(drop, { recursive: true });
    fs.copyFileSync(file, path.join(drop, path.basename(file)));
    console.log("  handed to the printer PC : " + drop);
    return true;
  } catch (e) {
    console.log("  HANDOFF FAILED: " + e.message);
    console.log("  (the PDF is still on this machine, and still on Telegram)");
    return false;
  }
}

// sendDocument, never getUpdates. The bot serves the website's order
// notifications by webhook, and a single getUpdates call would take those down
// silently for as long as nobody noticed.
function sendTelegram(file, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log("  telegram SKIPPED: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");
    return Promise.resolve(false);
  }

  const body = fs.readFileSync(file);
  const b = "----mwalimu" + Date.now();
  const head = (name, extra) =>
    Buffer.from("--" + b + "\r\nContent-Disposition: form-data; name=\"" + name + "\"" +
      (extra || "") + "\r\n\r\n");
  const payload = Buffer.concat([
    head("chat_id"), Buffer.from(String(chat)), Buffer.from("\r\n"),
    head("caption"), Buffer.from(caption), Buffer.from("\r\n"),
    head("document", "; filename=\"" + path.basename(file) + "\"\r\n" +
      "Content-Type: application/pdf"),
    body, Buffer.from("\r\n--" + b + "--\r\n"),
  ]);

  return new Promise((resolve) => {
    const req = require("https").request({
      hostname: "api.telegram.org", path: "/bot" + token + "/sendDocument", method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=" + b, "Content-Length": payload.length },
      timeout: 60000,
    }, (res) => {
      let out = "";
      res.on("data", d => out += d);
      res.on("end", () => {
        const ok = res.statusCode === 200;
        console.log("  telegram: " + (ok ? "sent" : "FAILED " + res.statusCode + " " + out.slice(0, 200)));
        resolve(ok);
      });
    });
    req.on("error", e => { console.log("  telegram FAILED: " + e.message); resolve(false); });
    req.on("timeout", () => { req.destroy(); console.log("  telegram FAILED: timeout"); resolve(false); });
    req.end(payload);
  });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log(describeConfigSource(cfg));
  console.log(APPLY ? "MODE: APPLY (will print and send)\n" : "MODE: dry run (writes the PDFs only)\n");

  // The trading day comes from the server: its clock runs about 24 minutes ahead
  // of every other machine here, and the sales being counted are stamped by it.
  // --as-of lets a past evening be re-run, and is how the seasonal factor was
  // checked against December without waiting for December.
  const asOf = process.argv.indexOf("--as-of");
  const today = asOf > 0 && process.argv[asOf + 1]
    ? new Date(process.argv[asOf + 1])
    : new Date((await q("select date_format(curdate(), '%Y-%m-%d') d"))[0].d);

  const smallest = await loadFactors();
  const sales = await loadSales(smallest);
  const items = await loadItems();
  const suppliers = await loadSuppliers();
  const lead = await loadLeadTimes();
  const totals = await loadDailyTotals();

  const season = seasonalFactor(totals, today, LEAD_DEFAULT + REVIEW_DAYS);
  console.log("Season: " + season.factor.toFixed(2) + "x — " + season.why);

  const stock = await loadStock([...sales.keys()]);
  const ctx = { stock, suppliers, lead, items, season };

  const rows = [];
  for (const [code, days] of sales) {
    const r = assess(code, days, today, ctx);
    if (r && r.order > 0) rows.push(r);
  }

  // Ranked by what it costs to be without, then grouped under the supplier to
  // phone — the grouping is how an order is placed, but it never decides what
  // appears on the sheet.
  const bySupplier = (list) => {
    const worst = new Map();
    for (const r of list) worst.set(r.sname, Math.max(worst.get(r.sname) || 0, r.atRisk));
    return [...list].sort((a, b) =>
      (worst.get(b.sname) - worst.get(a.sname)) || a.sname.localeCompare(b.sname) || b.atRisk - a.atRisk);
  };

  const ranked = [...rows].sort((a, b) => b.atRisk - a.atRisk);
  const forPaper = bySupplier(ranked.slice(0, PRINT_LINES));
  const forPdf = bySupplier(ranked);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = day(today);
  const when = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
  const caveat = "Does not know what is already on order — check the last-in column.";

  const paper = path.join(OUT_DIR, "restock-" + stamp + "-print.pdf");
  const full = path.join(OUT_DIR, "restock-" + stamp + "-full.pdf");
  await render(paper, "Restock \u2014 most urgent", forPaper, season, when, caveat, true);
  await render(full, "Restock \u2014 by supplier", forPdf, season, when, caveat, false);

  console.log("");
  console.log("  fast movers assessed : " + rows.length + " needing an order");
  console.log("  on paper             : " + forPaper.length + " lines, " +
    new Set(forPaper.map(r => r.sname)).size + " suppliers");
  console.log("  in the PDF           : " + forPdf.length + " lines, " +
    new Set(forPdf.map(r => r.sname)).size + " suppliers");
  console.log("  written              : " + paper);
  console.log("                         " + full);
  console.log("");

  // Every number behind every line, so the arithmetic can be checked against
  // the database by hand rather than taken on trust.
  if (process.argv.includes("--dump")) {
    const f = path.join(OUT_DIR, "restock-" + stamp + "-workings.tsv");
    const cols = ["code", "descr", "sname", "onHand", "r28", "r84", "base",
      "lead", "horizon", "safety", "cover", "order", "atRisk", "price", "rising"];
    const TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
    fs.writeFileSync(f, cols.join(TAB) + NL + ranked.map(r =>
      cols.map(k => typeof r[k] === "number" ? r[k].toFixed(3) : String(r[k]))
        .join(TAB)).join(NL));
    console.log("  workings             : " + f);
  }

  if (!APPLY) {
    console.log("Dry run — nothing printed, nothing sent.");
    return;
  }
  handOff(paper);
  await sendTelegram(full, "Restock list \u2014 " + stamp + ". " + forPdf.length +
    " lines. " + caveat);
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
