/**
 * Sale posting, against the fixture built from the live schema — including
 * the real do_stock_transactions procedure, so the stock side is exercised
 * for real rather than mocked.
 *
 * The shop's database is never touched by any of this.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../src/db/connection";
import { postSale, allocateReceiptNo, SaleValidationError, type SaleInput } from "../src/domain/sale";
import { RoundingTooLargeError } from "../src/money";
import { toCents } from "../src/money";

const OPTS = {
  host: process.env.MWALIMU_TEST_HOST ?? "127.0.0.1",
  port: Number(process.env.MWALIMU_TEST_PORT ?? 3307),
  user: process.env.MWALIMU_TEST_USER ?? "root",
  password: process.env.MWALIMU_TEST_PASSWORD ?? "",
  database: process.env.MWALIMU_TEST_DB ?? "mwalimuinvest_test",
};

let db: Database;
let available = false;
const CODE = "SALE001";

beforeAll(async () => {
  db = new Database(OPTS);
  available = await db.ping();
  if (!available) return;

  await db.query("DELETE FROM si WHERE CODE = ?", [CODE]);
  await db.query(
    `INSERT INTO si (CODE, descr, categ, PRICE, cost, active, forsale, taxable,
                     punit, sunit, revenue, cost_of_sales, inventory)
     VALUES (?,?,?,?,?,1,1,1,'UNITS','UNITS',?,?,?)`,
    [CODE, "Sale Test Lotion", "SKINCARE", 500, 300, "SALES-SKIN", "COGS-SKIN", "STOCK-SKIN"]);

  await db.query("DELETE FROM sq WHERE CODE = ?", [CODE]);
  await db.query(
    `INSERT INTO sq (CODE, descr, loc, quantity, qty, totalcost, wavgc)
     VALUES (?,?,?,?,?,?,?)`, [CODE, "Sale Test Lotion", "MAIN", 100, 100, 30000, 300]);

  // Clear receipts left by an earlier run before resetting the counter,
  // otherwise the numbers get re-issued and collide with rows already there.
  for (const t of ["pos_payment_details", "pos_details", "pos_header"]) {
    await db.query(`DELETE FROM ${t} WHERE receiptno LIKE 'TT%'`);
  }
  await db.query("DELETE FROM journal_transactions WHERE trancode LIKE 'TT%'");
  await db.query("DELETE FROM stran WHERE trancode LIKE 'TT%'");

  // A single settings row with a known VAT rate.
  await db.query("DELETE FROM nauto");
  await db.query(
    `INSERT INTO nauto (vat, pos, ppos, vatinclusive, costmode, vatoutput,
                        discountgiven, inventory, revenue)
     VALUES (16, 5000, 'T', 0, 0, 'VAT-OUT', 'DISC-GIVEN', 'STOCK', 'SALES')`);

  // Open the period the tests post into.
  await db.query("DELETE FROM periods WHERE yr = ?", [new Date().getFullYear()]);
  for (let m = 1; m <= 12; m += 1) {
    await db.query("INSERT INTO periods (yr, period, locked) VALUES (?,?,'0')",
                   [new Date().getFullYear(), m]);
  }
});

afterAll(async () => {
  if (db && available) {
    await db.query("DELETE FROM pos_details WHERE code = ?", [CODE]);
    await db.query("DELETE FROM si WHERE CODE = ?", [CODE]);
    await db.query("DELETE FROM sq WHERE CODE = ?", [CODE]);
    await db.query("DELETE FROM stran WHERE CODE = ?", [CODE]);
  }
  if (db) await db.close();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => { if (!available) return; await fn(); });

const basicSale = (over: Partial<SaleInput> = {}): SaleInput => ({
  lines: [{
    code: CODE, description: "Sale Test Lotion", qty: 2,
    unitPrice: toCents(500), buyCostExtended: toCents(600), unit: "UNITS",
  }],
  tenders: [{ method: "Cash", amount: toCents(1160), account: "CASH" }],
  location: "MAIN", staff: "TESTER", terminal: "TESTPC",
  ...over,
});

describe("allocateReceiptNo", () => {
  maybe("hands out a number built from the counter", async () => {
    const no = await allocateReceiptNo(db, "TESTER");
    expect(no).toMatch(/^TT\d+$/); // first letter of staff + ppos + pos
  });

  maybe("never hands the same number to two callers", async () => {
    // Two tills ringing up at once must not produce one receipt number. The
    // legacy app reads before updating and can.
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => allocateReceiptNo(db, "TESTER")));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("postSale", () => {
  maybe("writes header, lines, tenders, ledger and stock together", async () => {
    const before = await db.queryOne<any>(
      "SELECT quantity FROM sq WHERE CODE = ? AND loc = 'MAIN'", [CODE]);

    const result = await postSale(db, basicSale());
    expect(result.receiptNo).toBeTruthy();
    expect(result.total).toBe(toCents(1160)); // 1000 + 160 VAT

    const head = await db.queryOne<any>(
      "SELECT posted, amount, tax FROM pos_header WHERE receiptno = ?", [result.receiptNo]);
    expect(Number(head.posted)).toBe(1);

    const lines = await db.query("SELECT * FROM pos_details WHERE receiptno = ?", [result.receiptNo]);
    expect(lines).toHaveLength(1);

    const tenders = await db.query(
      "SELECT * FROM pos_payment_details WHERE receiptno = ?", [result.receiptNo]);
    expect(tenders).toHaveLength(1);

    // Stock came off, and via the procedure, so the sq cache moved with it.
    const after = await db.queryOne<any>(
      "SELECT quantity FROM sq WHERE CODE = ? AND loc = 'MAIN'", [CODE]);
    expect(Number(after.quantity)).toBe(Number(before.quantity) - 2);

    const stran = await db.query<any>(
      "SELECT ts, tqty FROM stran WHERE trancode = ?", [result.receiptNo]);
    expect(stran).toHaveLength(1);
    expect(stran[0].ts).toBe("-"); // a sale takes stock out
  });

  maybe("posts a ledger entry that balances exactly", async () => {
    const result = await postSale(db, basicSale());
    const row = await db.queryOne<any>(
      `SELECT SUM(IF(transign = '+', amount, -amount)) AS net, COUNT(*) AS legs
         FROM journal_transactions WHERE trancode = ?`, [result.receiptNo]);
    expect(Number(row.legs)).toBeGreaterThan(0);
    expect(Number(row.net)).toBe(0);
  });

  maybe("posts revenue and cost to the item's own accounts", async () => {
    // The item names SALES-SKIN and COGS-SKIN; using the shop-wide default
    // would silently put the money in the wrong place.
    const result = await postSale(db, basicSale());
    const codes = (await db.query<any>(
      "SELECT code FROM journal_transactions WHERE trancode = ?", [result.receiptNo]))
      .map(r => String(r.code));
    expect(codes).toContain("SALES-SKIN");
    expect(codes).toContain("COGS-SKIN");
    expect(codes).toContain("STOCK-SKIN");
  });

  maybe("balances a receipt whose total was rounded up", async () => {
    // 3 x 33.33 exclusive = 99.99 + 16.00 VAT = 115.99, which ceils to 116.00.
    // The extra cent has to go somewhere or the entry will not balance.
    const result = await postSale(db, basicSale({
      lines: [{ code: CODE, description: "Sale Test Lotion", qty: 3,
                unitPrice: toCents(33.33), buyCostExtended: toCents(60), unit: "UNITS" }],
      tenders: [{ method: "Cash", amount: toCents(116), account: "CASH" }],
    }));
    const row = await db.queryOne<any>(
      `SELECT SUM(IF(transign = '+', amount, -amount)) AS net
         FROM journal_transactions WHERE trancode = ?`, [result.receiptNo]);
    expect(Number(row.net)).toBe(0);
  });

  maybe("records change given without unbalancing the entry", async () => {
    const result = await postSale(db, basicSale({
      tenders: [{ method: "Cash", amount: toCents(2000), account: "CASH" }],
    }));
    expect(result.change).toBe(toCents(840)); // 2000 - 1160
    const row = await db.queryOne<any>(
      `SELECT SUM(IF(transign = '+', amount, -amount)) AS net
         FROM journal_transactions WHERE trancode = ?`, [result.receiptNo]);
    expect(Number(row.net)).toBe(0);
  });

  maybe("splits a mixed tender across its accounts", async () => {
    const result = await postSale(db, basicSale({
      tenders: [
        { method: "Cash",   amount: toCents(600), account: "CASH" },
        { method: "M-Pesa", amount: toCents(560), account: "MPESA", reference: "QA123" },
      ],
    }));
    const tenders = await db.query<any>(
      "SELECT payname, pamount FROM pos_payment_details WHERE receiptno = ? ORDER BY paynumber",
      [result.receiptNo]);
    expect(tenders).toHaveLength(2);
    const row = await db.queryOne<any>(
      `SELECT SUM(IF(transign = '+', amount, -amount)) AS net
         FROM journal_transactions WHERE trancode = ?`, [result.receiptNo]);
    expect(Number(row.net)).toBe(0);
  });
});

describe("postSale refuses bad input before writing anything", () => {
  maybe("rejects an empty sale", async () => {
    await expect(postSale(db, basicSale({ lines: [] }))).rejects.toThrow(SaleValidationError);
  });

  maybe("rejects a zero or negative quantity", async () => {
    await expect(postSale(db, basicSale({
      lines: [{ code: CODE, description: "x", qty: 0, unitPrice: toCents(500), buyCostExtended: 0 }],
    }))).rejects.toThrow(SaleValidationError);
  });

  maybe("rejects a discount larger than the line", async () => {
    await expect(postSale(db, basicSale({
      lines: [{ code: CODE, description: "x", qty: 1, unitPrice: toCents(100),
                discount: toCents(200), buyCostExtended: 0 }],
    }))).rejects.toThrow(SaleValidationError);
  });

  maybe("rejects tender less than the total", async () => {
    await expect(postSale(db, basicSale({
      tenders: [{ method: "Cash", amount: toCents(100), account: "CASH" }],
    }))).rejects.toThrow(SaleValidationError);
  });

  maybe("leaves nothing behind when it refuses", async () => {
    const before = await db.queryOne<any>("SELECT COUNT(*) AS n FROM pos_header");
    await postSale(db, basicSale({ lines: [] })).catch(() => undefined);
    await postSale(db, basicSale({
      tenders: [{ method: "Cash", amount: 1, account: "CASH" }],
    })).catch(() => undefined);
    const after = await db.queryOne<any>("SELECT COUNT(*) AS n FROM pos_header");
    expect(Number(after.n)).toBe(Number(before.n));
  });
});

describe("a sale that fails part-way through leaves nothing behind", () => {
  maybe("rolls back the header, lines, ledger and stock together", async () => {
    // Forced by pointing the counter at a receipt number already taken, so
    // the header insert fails after the transaction has opened. This is the
    // guarantee the whole design rests on: a sale is all of it or none of it,
    // never a half-posted receipt with stock moved and no money recorded.
    const taken = await postSale(db, basicSale());

    const before = {
      headers: Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM pos_header")).n),
      lines:   Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM pos_details")).n),
      legs:    Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM journal_transactions")).n),
      stran:   Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM stran")).n),
      stock:   Number((await db.queryOne<any>(
                 "SELECT quantity FROM sq WHERE CODE = ? AND loc = 'MAIN'", [CODE])).quantity),
    };

    // Wind the counter back so the next allocation returns `taken` again.
    const digits = taken.receiptNo.replace(/^\D+/, "");
    await db.query("UPDATE nauto SET pos = ?", [Number(digits) - 1]);

    await expect(postSale(db, basicSale())).rejects.toThrow();

    const after = {
      headers: Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM pos_header")).n),
      lines:   Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM pos_details")).n),
      legs:    Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM journal_transactions")).n),
      stran:   Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM stran")).n),
      stock:   Number((await db.queryOne<any>(
                 "SELECT quantity FROM sq WHERE CODE = ? AND loc = 'MAIN'", [CODE])).quantity),
    };

    expect(after).toEqual(before);
  });
});

describe("period locking", () => {
  maybe("refuses to post into a locked period", async () => {
    const yr = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    await db.query("UPDATE periods SET locked = '1' WHERE yr = ? AND period = ?", [yr, month]);
    try {
      await expect(postSale(db, basicSale())).rejects.toThrow(/locked/i);
    } finally {
      await db.query("UPDATE periods SET locked = '0' WHERE yr = ? AND period = ?", [yr, month]);
    }
  });
});
