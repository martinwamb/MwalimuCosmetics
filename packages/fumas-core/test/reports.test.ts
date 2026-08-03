/**
 * Runs every read-only query against the fixture built from the captured
 * schema. The point is less the numbers than the SQL: these must execute
 * against the real column names and types, because a query that only works
 * against an invented schema is worse than no query at all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../src/db/connection";
import {
  searchItems, getLowStock, getStockMovements,
  getSales, getSaleLines, getDaySummary, getPaymentMix, getTopProducts,
  getSupplierBalances, findUnbalancedEntries,
} from "../src/domain/reports";
import { getPeriodStatus, assertPeriodOpen, PeriodLockedError } from "../src/domain/settings";

const OPTS = {
  host: process.env.MWALIMU_TEST_HOST ?? "127.0.0.1",
  port: Number(process.env.MWALIMU_TEST_PORT ?? 3307),
  user: process.env.MWALIMU_TEST_USER ?? "root",
  password: process.env.MWALIMU_TEST_PASSWORD ?? "",
  database: process.env.MWALIMU_TEST_DB ?? "mwalimuinvest_test",
};

let db: Database;
let available = false;

beforeAll(async () => {
  db = new Database(OPTS);
  available = await db.ping();
  if (!available) return;

  await db.query("DELETE FROM si WHERE CODE IN ('RPT001','RPT002')");
  await db.query(
    `INSERT INTO si (CODE, descr, categ, PRICE, WPRICE, cost, active, forsale, rolqty)
     VALUES (?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?)`,
    ["RPT001", "Report Test Lotion", "COSMETICS", 500, 450, 300, 1, 1, 10,
     "RPT002", "Report Test Soap",   "COSMETICS", 120, 100,  70, 1, 1, 5]);

  await db.query("DELETE FROM sq WHERE CODE IN ('RPT001','RPT002')");
  await db.query(
    `INSERT INTO sq (CODE, descr, loc, quantity, qty, totalcost, wavgc)
     VALUES (?,?,?,?,?,?,?), (?,?,?,?,?,?,?)`,
    ["RPT001", "Report Test Lotion", "MAIN", 40, 40, 12000, 300,
     "RPT002", "Report Test Soap",   "MAIN",  2,  2,   140,  70]);

  await db.query("DELETE FROM pos_header WHERE receiptno IN ('RPT-R1','RPT-R2')");
  await db.query(
    `INSERT INTO pos_header (receiptno, amount, tax, disc, arname, staff, trandate, posdate, posted, is_return)
     VALUES (?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?)`,
    ["RPT-R1", 1160, 160, 0, "Walk-in", "TESTCASH", "2026-08-01 10:00:00", "2026-08-01", 1, 0,
     // Parked and never paid for: must not count towards the day's takings.
     "RPT-R2",  500,  69, 0, "Walk-in", "TESTCASH", "2026-08-01 11:00:00", "2026-08-01", 0, 0]);

  await db.query("DELETE FROM pos_details WHERE receiptno IN ('RPT-R1','RPT-R2')");
  await db.query(
    `INSERT INTO pos_details (receiptno, code, description, qty, price, total, vat, disc, inclusive, taxable)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["RPT-R1", "RPT001", "Report Test Lotion", 2, 500, 1000, 160, 0, "NO", "YES"]);

  await db.query("DELETE FROM pos_payment_details WHERE receiptno IN ('RPT-R1','RPT-R2')");
  await db.query(
    `INSERT INTO pos_payment_details (receiptno, paynumber, payname, pamount, pdebtorsac)
     VALUES (?,?,?,?,?)`,
    ["RPT-R1", 1, "Cash", 1160, "CASH"]);
});

afterAll(async () => {
  if (db && available) {
    await db.query("DELETE FROM si WHERE CODE IN ('RPT001','RPT002')");
    await db.query("DELETE FROM sq WHERE CODE IN ('RPT001','RPT002')");
    await db.query("DELETE FROM pos_header WHERE receiptno IN ('RPT-R1','RPT-R2')");
    await db.query("DELETE FROM pos_details WHERE receiptno IN ('RPT-R1','RPT-R2')");
    await db.query("DELETE FROM pos_payment_details WHERE receiptno IN ('RPT-R1','RPT-R2')");
    await db.query("DELETE FROM periods WHERE yr = 2099");
  }
  if (db) await db.close();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => { if (!available) return; await fn(); });

describe("catalogue and stock", () => {
  maybe("searches by code and description", async () => {
    const byCode = await searchItems(db, { search: "RPT001" });
    expect(byCode.map(i => i.code)).toContain("RPT001");

    const byName = await searchItems(db, { search: "Report Test" });
    expect(byName.length).toBeGreaterThanOrEqual(2);
  });

  maybe("reports prices in cents and stock from the sq cache", async () => {
    const [item] = await searchItems(db, { search: "RPT001" });
    expect(item!.retailPrice).toBe(50000);   // 500.00
    expect(item!.wholesalePrice).toBe(45000);
    expect(item!.cost).toBe(30000);
    expect(item!.onHand).toBe(40);
  });

  maybe("flags items at or below their reorder level", async () => {
    const low = await getLowStock(db, 50);
    const codes = low.map(i => i.code);
    // RPT002 has 2 on hand against a reorder level of 5; RPT001 has 40 vs 10.
    expect(codes).toContain("RPT002");
    expect(codes).not.toContain("RPT001");
  });

  maybe("lists stock movements without error", async () => {
    const moves = await getStockMovements(db, "RPT001", 10);
    expect(Array.isArray(moves)).toBe(true);
  });
});

describe("sales", () => {
  maybe("lists receipts in a date range", async () => {
    const sales = await getSales(db, { fromDate: "2026-08-01", toDate: "2026-08-01" });
    expect(sales.map(s => s.receiptNo)).toContain("RPT-R1");
  });

  maybe("returns the lines on a receipt", async () => {
    const lines = await getSaleLines(db, "RPT-R1");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.code).toBe("RPT001");
    expect(lines[0]!.total).toBe(100000); // 1000.00
  });

  maybe("counts only posted receipts towards the day's takings", async () => {
    // RPT-R2 is parked: the money was never collected, so including it would
    // overstate the day.
    const day = await getDaySummary(db, "2026-08-01");
    expect(day.transactions).toBe(1);
    expect(day.gross).toBe(116000);  // 1160.00, not 1660.00
    expect(day.tax).toBe(16000);
  });

  maybe("breaks the day down by tender", async () => {
    const mix = await getPaymentMix(db, "2026-08-01");
    expect(mix).toHaveLength(1);
    expect(mix[0]!.method).toBe("Cash");
    expect(mix[0]!.total).toBe(116000);
  });

  maybe("ranks top products using the canonical net-line formula", async () => {
    const top = await getTopProducts(db, "2026-08-01", "2026-08-01", 10);
    const row = top.find(t => t.code === "RPT001");
    expect(row).toBeDefined();
    // Exclusive line: total + vat - disc = 1000 + 160 - 0
    expect(row!.revenue).toBe(116000);
    expect(row!.qty).toBe(2);
  });
});

describe("suppliers and reconciliation", () => {
  maybe("reads creditor balances", async () => {
    expect(Array.isArray(await getSupplierBalances(db, 10))).toBe(true);
  });

  maybe("reports entries whose debits and credits differ", async () => {
    const bad = await findUnbalancedEntries(db, "2026-08-01", "2026-08-01", 10);
    expect(Array.isArray(bad)).toBe(true);
  });
});

describe("accounting periods", () => {
  maybe("treats a missing period as locked", async () => {
    // Fails closed, matching the legacy behaviour: posting into a period
    // nobody has opened is worse than being stopped.
    const status = await getPeriodStatus(db, "2099-06-15");
    expect(status.exists).toBe(false);
    expect(status.locked).toBe(true);
    await expect(assertPeriodOpen(db, "2099-06-15")).rejects.toThrow(PeriodLockedError);
  });

  maybe("allows posting into an open period", async () => {
    await db.query("DELETE FROM periods WHERE yr = 2099");
    await db.query("INSERT INTO periods (yr, period, locked) VALUES (?,?,?)", [2099, 6, "0"]);
    const status = await getPeriodStatus(db, "2099-06-15");
    expect(status.exists).toBe(true);
    expect(status.locked).toBe(false);
    await expect(assertPeriodOpen(db, "2099-06-15")).resolves.toBeUndefined();
  });

  maybe("blocks a locked period", async () => {
    await db.query("DELETE FROM periods WHERE yr = 2099");
    await db.query("INSERT INTO periods (yr, period, locked) VALUES (?,?,?)", [2099, 7, "1"]);
    await expect(assertPeriodOpen(db, "2099-07-15")).rejects.toThrow(PeriodLockedError);
  });
});
