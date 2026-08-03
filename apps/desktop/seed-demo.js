/**
 * Fill the local test database with believable data so the app can be
 * explored without a connection to the shop.
 *
 * This only ever touches a database whose name contains "test", so it cannot
 * be pointed at the real one by accident.
 *
 *   node seed-demo.js
 */

const mysql = require("mysql");
const path = require("path");
const { encryptPassword } = require(
  path.join(__dirname, "..", "..", "packages", "fumas-core", "dist", "index.js"));

const CONFIG = {
  host: process.env.MWALIMU_TEST_HOST ?? "127.0.0.1",
  port: Number(process.env.MWALIMU_TEST_PORT ?? 3307),
  user: process.env.MWALIMU_TEST_USER ?? "root",
  password: process.env.MWALIMU_TEST_PASSWORD ?? "",
  database: process.env.MWALIMU_TEST_DB ?? "mwalimuinvest_test",
  insecureAuth: true, ssl: false,
};

if (!/test/i.test(CONFIG.database)) {
  console.error(`Refusing to seed "${CONFIG.database}" — this only runs against a test database.`);
  process.exit(1);
}

const conn = mysql.createConnection(CONFIG);
const q = (sql, params) => new Promise((res, rej) =>
  conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r)));

const ITEMS = [
  ["CM-1001", "Nivea Body Lotion 400ml",       "SKINCARE",  850,  760,  520, 12],
  ["CM-1002", "Vaseline Petroleum Jelly 250ml", "SKINCARE",  320,  280,  190, 20],
  ["CM-1003", "Dove Beauty Bar 100g",           "SOAP",      180,  150,  105, 40],
  ["CM-1004", "Sunsilk Shampoo 400ml",          "HAIRCARE",  640,  570,  390, 15],
  ["CM-1005", "Dark & Lovely Relaxer Kit",      "HAIRCARE", 1250, 1100,  780,  8],
  ["CM-1006", "Rexona Roll-On 50ml",            "DEODORANT", 420,  370,  255, 25],
  ["CM-1007", "Colgate Toothpaste 140g",        "ORAL",      290,  250,  175, 30],
  ["CM-1008", "Johnson's Baby Oil 200ml",       "BABY",      560,  495,  340, 10],
  ["CM-1009", "Garnier Micellar Water 400ml",   "SKINCARE", 1180, 1050,  740,  6],
  ["CM-1010", "Tresemme Conditioner 400ml",     "HAIRCARE",  790,  700,  480,  9],
  ["CM-1011", "Cerave Moisturising Cream 340g", "SKINCARE", 2450, 2200, 1580,  4],
  ["CM-1012", "Maybelline Fit Me Foundation",   "MAKEUP",   1650, 1480, 1050,  5],
];

// Deliberately varied so the low-stock panel has something to say.
const STOCK = {
  "CM-1001": 48, "CM-1002": 120, "CM-1003": 210, "CM-1004": 33,
  "CM-1005": 3,  "CM-1006": 64,  "CM-1007": 88,  "CM-1008": 0,
  "CM-1009": 2,  "CM-1010": 27,  "CM-1011": 6,   "CM-1012": 1,
};

const SUPPLIERS = [
  ["SUP-001", "Beiersdorf East Africa", 284500],
  ["SUP-002", "Unilever Kenya Ltd",     512300],
  ["SUP-003", "L'Oreal East Africa",    138900],
  ["SUP-004", "Haco Industries",         67200],
  ["SUP-005", "PZ Cussons Kenya",             0],
];

const STAFF = ["JANE", "MERCY", "PETER"];
const CUSTOMERS = ["Walk-in", "Walk-in", "Walk-in", "Grace W.", "Salon Bella", "Walk-in"];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const kenyanDate = (offset) =>
  new Date(Date.now() + 3 * 3600e3 - offset * 86400e3).toISOString().slice(0, 10);

async function run() {
  await q("SET SESSION sql_mode = ?", ["IGNORE_SPACE"]);
  console.log(`Seeding ${CONFIG.database}…`);

  // ── Settings, so VAT and the rest read sensibly ────────────────
  const nauto = await q("SELECT COUNT(*) AS n FROM nauto");
  if (Number(nauto[0].n) === 0) await q("INSERT INTO nauto (vat, pos) VALUES (16, 1000)");
  else await q("UPDATE nauto SET vat = 16");

  // ── Open the current and next few periods ─────────────────────
  await q("DELETE FROM periods WHERE yr >= YEAR(CURDATE())");
  const now = new Date();
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    await q("INSERT INTO periods (yr, period, locked) VALUES (?,?,?)",
            [d.getFullYear(), d.getMonth() + 1, "0"]);
  }
  console.log("  periods opened for the next 6 months");

  // ── People ────────────────────────────────────────────────────
  await q("DELETE FROM users WHERE usercode IN ('demo','jane')");
  await q(`INSERT INTO users (usercode, username, password, Clocation, clevel)
           VALUES (?,?,?,?,?), (?,?,?,?,?)`,
    ["demo", "Demo Manager", encryptPassword("demo123"), "MAIN", "9",
     "jane", "Jane (Cashier)", encryptPassword("jane123"), "MAIN", "1"]);

  await q("DELETE FROM users_rights WHERE code IN ('demo','jane')");
  // The manager sees everything; the cashier only the sales screen. Signing in
  // as each shows the rights model actually working.
  for (const f of ["Fitemlist", "FPosList", "FPrepayment_creditors"]) {
    await q(`INSERT INTO users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap)
             VALUES (?,?,?,?,?,?,?)`, ["demo", f, "1", "1", "1", "1", "1"]);
  }
  await q(`INSERT INTO users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap)
           VALUES (?,?,?,?,?,?,?)`, ["jane", "FPosList", "1", "1", "0", "0", "0"]);
  console.log("  users: demo / demo123  and  jane / jane123");

  // ── Catalogue and stock ───────────────────────────────────────
  const codes = ITEMS.map(i => i[0]);
  const holes = codes.map(() => "?").join(",");
  await q(`DELETE FROM si WHERE CODE IN (${holes})`, codes);
  await q(`DELETE FROM sq WHERE CODE IN (${holes})`, codes);

  for (const [code, descr, categ, price, wprice, cost, rolqty] of ITEMS) {
    await q(`INSERT INTO si (CODE, descr, categ, PRICE, WPRICE, cost, active, forsale,
                             forpurchase, taxable, rolqty, punit, sunit)
             VALUES (?,?,?,?,?,?,1,1,1,1,?, 'UNITS','UNITS')`,
            [code, descr, categ, price, wprice, cost, rolqty]);
    await q(`INSERT INTO sq (CODE, descr, loc, quantity, qty, totalcost, wavgc)
             VALUES (?,?,?,?,?,?,?)`,
            [code, descr, "MAIN", STOCK[code], STOCK[code], STOCK[code] * cost, cost]);
  }
  console.log(`  ${ITEMS.length} products, with stock`);

  // ── Suppliers ─────────────────────────────────────────────────
  for (const [code, name, owed] of SUPPLIERS) {
    await q("DELETE FROM su WHERE code = ?", [code]);
    await q("INSERT INTO su (code, names, active) VALUES (?,?,1)", [code, name]);
    await q("DELETE FROM accounts WHERE code = ?", [code]);
    await q(`INSERT INTO accounts (code, description, nb, prepaid, active)
             VALUES (?,?, 'Creditors', ?, 1)`, [code, name, owed]);
  }
  console.log(`  ${SUPPLIERS.length} suppliers with balances`);

  // ── Two weeks of trading ──────────────────────────────────────
  await q("DELETE FROM pos_payment_details WHERE receiptno LIKE 'D%'");
  await q("DELETE FROM pos_details WHERE receiptno LIKE 'D%'");
  await q("DELETE FROM pos_header WHERE receiptno LIKE 'D%'");
  await q("DELETE FROM journal_transactions WHERE trancode LIKE 'D%'");

  const VAT = 0.16;
  let receipts = 0, lines = 0;

  for (let day = 13; day >= 0; day -= 1) {
    const date = kenyanDate(day);
    // Busier at weekends, which makes the day-to-day figures look real.
    const weekday = new Date(date + "T12:00:00Z").getUTCDay();
    const count = (weekday === 0 || weekday === 6) ? 9 + Math.floor(Math.random() * 6)
                                                   : 4 + Math.floor(Math.random() * 5);

    for (let n = 0; n < count; n += 1) {
      receipts += 1;
      const receiptNo = `D${String(receipts).padStart(5, "0")}`;
      const hour = 8 + Math.floor(Math.random() * 10);
      const stamp = `${date} ${String(hour).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}:00`;
      const staff = pick(STAFF);

      const basket = [];
      const lineCount = 1 + Math.floor(Math.random() * 3);
      for (let l = 0; l < lineCount; l += 1) {
        const item = pick(ITEMS);
        const qty = 1 + Math.floor(Math.random() * 3);
        const gross = item[3] * qty;
        // Prices here are VAT-exclusive, so tax is added on top.
        const vat = Math.round(gross * VAT * 100) / 100;
        basket.push({ item, qty, gross, vat });
      }

      const grossTotal = basket.reduce((s, b) => s + b.gross, 0);
      const vatTotal   = Math.round(basket.reduce((s, b) => s + b.vat, 0) * 100) / 100;
      const amount     = Math.ceil(grossTotal + vatTotal);

      // A couple of receipts are left parked, so the difference between a
      // completed and an abandoned sale is visible in the app.
      const posted = Math.random() > 0.06 ? 1 : 0;

      await q(`INSERT INTO pos_header
                 (receiptno, amount, tax, disc, arname, staff, salesref, trandate, posdate,
                  posted, is_return, location, tyype, paid, changee)
               VALUES (?,?,?,0,?,?,?,?,?,?,0,'MAIN',?,?,0)`,
        [receiptNo, amount, vatTotal, pick(CUSTOMERS), staff, staff, stamp, date, posted,
         "Cash Sale", amount]);

      for (const b of basket) {
        lines += 1;
        await q(`INSERT INTO pos_details
                   (receiptno, code, description, qty, price, total, vat, disc,
                    inclusive, taxable, nunit, buy_cost, location, type, transign)
                 VALUES (?,?,?,?,?,?,?,0,'NO','YES','UNITS',?, 'MAIN','Stocks','+')`,
          [receiptNo, b.item[0], b.item[1], b.qty, b.item[3], b.gross, b.vat,
           b.item[5] * b.qty]);
      }

      if (posted) {
        // Cash mostly, M-Pesa often, card occasionally — roughly how a shop
        // like this actually gets paid.
        const r = Math.random();
        const method = r < 0.45 ? "Cash" : r < 0.85 ? "M-Pesa" : "Card";
        const account = method === "Cash" ? "CASH" : method === "M-Pesa" ? "MPESA" : "CARD";
        await q(`INSERT INTO pos_payment_details
                   (receiptno, paynumber, payname, pamount, payref, pdebtorsac)
                 VALUES (?,?,?,?,?,?)`,
          [receiptNo, 1, method, amount, method === "M-Pesa" ? `Q${receipts}XY` : "", account]);
      }
    }
  }
  console.log(`  ${receipts} receipts over 14 days, ${lines} lines`);

  conn.end();
  console.log("");
  console.log("Done. Sign in as  demo / demo123  (manager)  or  jane / jane123  (cashier).");
}

run().catch(e => { console.error("Failed:", e.message); conn.end(); process.exit(1); });
