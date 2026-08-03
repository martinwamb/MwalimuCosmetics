/**
 * Integration tests against the local MySQL 5.7 instance, loaded from the
 * schema and routines captured off the live server.
 *
 * These never touch the shop's database. Skipped automatically when the local
 * instance is not running, so the suite stays green on a machine without it.
 *
 *   npm run testdb:reset    to (re)build the fixture
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../src/db/connection";

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
  if (!available) {
    console.warn(`\n  Local MySQL not reachable at ${OPTS.host}:${OPTS.port} — integration tests skipped.\n`);
  }
});

afterAll(async () => { if (db) await db.close(); });

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => { if (!available) return; await fn(); });

describe("Database against the real captured schema", () => {
  maybe("reads the item master, which is `si` and not `sitems`", async () => {
    const row = await db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM si");
    expect(row).not.toBeNull();
    expect(Number(row!.n)).toBeGreaterThanOrEqual(0);
  });

  maybe("has the stock procedures that are the only way to move stock", async () => {
    const rows = await db.query<{ ROUTINE_NAME: string }>(
      `SELECT ROUTINE_NAME FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME IN
              ('do_stock_transactions','do_siserial_transactions','get_smallest_qty')`,
      [OPTS.database],
    );
    expect(rows.map(r => r.ROUTINE_NAME).sort())
      .toEqual(["do_siserial_transactions", "do_stock_transactions", "get_smallest_qty"]);
  });

  maybe("passes parameters rather than concatenating them", async () => {
    // An apostrophe is the exact input the legacy escaping corrupted: it
    // replaced ' with a backtick instead of escaping it.
    const row = await db.queryOne<{ v: string }>("SELECT ? AS v", ["O'Brien & Co"]);
    expect(row!.v).toBe("O'Brien & Co");
  });

  maybe("returns dates as strings so they cannot shift by the UTC+3 offset", async () => {
    const row = await db.queryOne<{ d: unknown }>("SELECT DATE('2026-08-01') AS d");
    expect(typeof row!.d).toBe("string");
    expect(row!.d).toBe("2026-08-01");
  });

  maybe("returns decimals as strings so money never becomes a float", async () => {
    const row = await db.queryOne<{ m: unknown }>("SELECT CAST(1234.56 AS DECIMAL(10,2)) AS m");
    expect(typeof row!.m).toBe("string");
  });
});

describe("withTransaction", () => {
  const CODE = "TXTEST";

  maybe("commits everything on success", async () => {
    await db.query("DELETE FROM journal_transactions WHERE trancode = ?", [CODE]);

    await db.withTransaction(async tx => {
      for (const sign of ["+", "-"]) {
        await tx.query(
          `INSERT INTO journal_transactions (code,remarks,amount,jtdate,trancode,trantype,staff,transign,rec,r_amt,source)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          ["CASH", "tx test", 100, "2026-08-01", CODE, "POS", "test", sign, "n", 0, CODE]);
      }
    });

    const row = await db.queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM journal_transactions WHERE trancode = ?", [CODE]);
    expect(Number(row!.n)).toBe(2);
    await db.query("DELETE FROM journal_transactions WHERE trancode = ?", [CODE]);
  });

  maybe("rolls back every write when the work throws", async () => {
    // The guarantee the whole atomic-sale design rests on: a sale that fails
    // halfway must leave nothing behind, not a half-posted receipt.
    await db.query("DELETE FROM journal_transactions WHERE trancode = ?", [CODE]);

    await expect(db.withTransaction(async tx => {
      await tx.query(
        `INSERT INTO journal_transactions (code,remarks,amount,jtdate,trancode,trantype,staff,transign,rec,r_amt,source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ["CASH", "doomed", 100, "2026-08-01", CODE, "POS", "test", "+", "n", 0, CODE]);

      // Stand-in for a later step failing, e.g. the balance check refusing
      // to post, or the stock procedure erroring.
      throw new Error("simulated failure after the first write");
    })).rejects.toThrow("simulated failure");

    const row = await db.queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM journal_transactions WHERE trancode = ?", [CODE]);
    expect(Number(row!.n)).toBe(0);
  });

  maybe("returns the callback's value", async () => {
    const out = await db.withTransaction(async tx => {
      const r = await tx.queryOne<{ v: number }>("SELECT 42 AS v");
      return Number(r!.v);
    });
    expect(out).toBe(42);
  });
});

describe("query pacing", () => {
  maybe("leaves a minimum gap between statements", async () => {
    // Pacing is what keeps diagnostic work from slowing the tills, given the
    // server cannot be worked on outside trading hours.
    const paced = new Database(OPTS, 120);
    try {
      const started = Date.now();
      await Promise.all([
        paced.query("SELECT 1"),
        paced.query("SELECT 2"),
        paced.query("SELECT 3"),
      ]);
      // Three statements, two gaps between them.
      expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    } finally {
      await paced.close();
    }
  });
});
