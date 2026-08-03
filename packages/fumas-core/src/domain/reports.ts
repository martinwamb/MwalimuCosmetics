/**
 * Read-only queries backing the desktop screens.
 *
 * Nothing here writes, so these are safe to run against the live database
 * while the shop is trading. They are still written to be cheap: bounded by
 * date, limited in row count, and never joining the full history of
 * pos_details, because this server also runs the tills.
 */

import type { Queryable } from "../db/connection";
import { parseMoney, type Cents } from "../money";

// ── Catalogue and stock ──────────────────────────────────────────

export interface ItemSummary {
  code: string;
  description: string;
  category: string | null;
  retailPrice: Cents;
  wholesalePrice: Cents;
  cost: Cents;
  active: boolean;
  /** Live quantity in smallest units, summed from the stock ledger. */
  onHand: number;
}

/**
 * Search the item master, with stock on hand.
 *
 * Quantity comes from `sq`, the cache the stock procedure maintains, rather
 * than by summing `stran` for every row. Summing the ledger is what the
 * legacy app does and it is fine for one item, but across a search result it
 * is a table scan per row. `sq` is written by do_stock_transactions inside
 * the same transaction as the movement, so it is authoritative rather than a
 * stale convenience.
 */
export async function searchItems(
  db: Queryable,
  opts: { search?: string; location?: string; limit?: number; activeOnly?: boolean } = {},
): Promise<ItemSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const params: unknown[] = [];

  let where = "1=1";
  if (opts.activeOnly !== false) where += " AND i.active = 1";
  if (opts.search) {
    // Matching the code from the start lets the index help; the description
    // needs a contains match to be useful at a counter.
    where += " AND (i.CODE LIKE ? OR i.descr LIKE ?)";
    params.push(`${opts.search}%`, `%${opts.search}%`);
  }

  let stockJoin = "LEFT JOIN sq q ON q.CODE = i.CODE";
  if (opts.location) {
    stockJoin += " AND q.loc = ?";
    params.push(opts.location);
  }

  const rows = await db.query<any>(
    `SELECT i.CODE AS code, i.descr, i.categ, i.PRICE, i.WPRICE, i.cost, i.active,
            COALESCE(SUM(q.quantity), 0) AS onHand
       FROM si i
       ${stockJoin}
      WHERE ${where}
      GROUP BY i.CODE, i.descr, i.categ, i.PRICE, i.WPRICE, i.cost, i.active
      ORDER BY i.descr
      LIMIT ${limit}`,
    params,
  );

  return rows.map(r => ({
    code: String(r.code),
    description: String(r.descr ?? ""),
    category: r.categ ? String(r.categ) : null,
    retailPrice: parseMoney(r.PRICE),
    wholesalePrice: parseMoney(r.WPRICE),
    cost: parseMoney(r.cost),
    active: Number(r.active) === 1,
    onHand: Number(r.onHand ?? 0),
  }));
}

/** Items at or below their reorder level, worst first. */
export async function getLowStock(db: Queryable, limit = 50): Promise<ItemSummary[]> {
  const rows = await db.query<any>(
    `SELECT i.CODE AS code, i.descr, i.categ, i.PRICE, i.WPRICE, i.cost, i.active,
            COALESCE(SUM(q.quantity), 0) AS onHand, i.rolqty
       FROM si i
       LEFT JOIN sq q ON q.CODE = i.CODE
      WHERE i.active = 1 AND i.forsale = 1
      GROUP BY i.CODE, i.descr, i.categ, i.PRICE, i.WPRICE, i.cost, i.active, i.rolqty
     HAVING onHand <= COALESCE(i.rolqty, 0)
      ORDER BY onHand ASC
      LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
  );

  return rows.map(r => ({
    code: String(r.code),
    description: String(r.descr ?? ""),
    category: r.categ ? String(r.categ) : null,
    retailPrice: parseMoney(r.PRICE),
    wholesalePrice: parseMoney(r.WPRICE),
    cost: parseMoney(r.cost),
    active: Number(r.active) === 1,
    onHand: Number(r.onHand ?? 0),
  }));
}

/** Recent stock movements for one item, newest first. */
export async function getStockMovements(
  db: Queryable, code: string, limit = 50,
): Promise<Array<{
  date: string; description: string; reference: string; location: string;
  quantity: number; direction: "in" | "out";
}>> {
  const rows = await db.query<any>(
    `SELECT stdate, trandesc, trancode, loc, tqty, ts
       FROM stran
      WHERE CODE = ?
      ORDER BY stid DESC
      LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
    [code],
  );

  return rows.map(r => ({
    date: String(r.stdate ?? ""),
    description: String(r.trandesc ?? ""),
    reference: String(r.trancode ?? ""),
    location: String(r.loc ?? ""),
    quantity: Number(r.tqty ?? 0),
    direction: String(r.ts) === "+" ? "in" as const : "out" as const,
  }));
}

// ── Sales ────────────────────────────────────────────────────────

export interface SaleSummary {
  receiptNo: string;
  date: string;
  customer: string;
  staff: string;
  total: Cents;
  tax: Cents;
  discount: Cents;
  posted: boolean;
  isReturn: boolean;
}

/** Receipts within a date range, newest first. */
export async function getSales(
  db: Queryable,
  opts: { fromDate: string; toDate: string; limit?: number; includeReturns?: boolean } = {
    fromDate: "", toDate: "",
  },
): Promise<SaleSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await db.query<any>(
    `SELECT receiptno, trandate, arname, COALESCE(salesref, staff) AS staff,
            amount, tax, disc, posted, is_return
       FROM pos_header
      WHERE DATE(trandate) BETWEEN ? AND ?
        AND receiptno <> 'AUTO'
        ${opts.includeReturns ? "" : "AND is_return = 0"}
      ORDER BY trandate DESC, posid DESC
      LIMIT ${limit}`,
    [opts.fromDate, opts.toDate],
  );

  return rows.map(r => ({
    receiptNo: String(r.receiptno),
    date: String(r.trandate ?? ""),
    customer: String(r.arname ?? ""),
    staff: String(r.staff ?? ""),
    total: parseMoney(r.amount),
    tax: parseMoney(r.tax),
    discount: parseMoney(r.disc),
    posted: Number(r.posted) === 1,
    isReturn: Number(r.is_return) === 1,
  }));
}

/** The lines on one receipt. */
export async function getSaleLines(
  db: Queryable, receiptNo: string,
): Promise<Array<{
  code: string; description: string; qty: number;
  unitPrice: Cents; total: Cents; vat: Cents; discount: Cents;
}>> {
  const rows = await db.query<any>(
    `SELECT code, description, qty, price, total, vat, disc
       FROM pos_details
      WHERE receiptno = ?
      ORDER BY posdid`,
    [receiptNo],
  );

  return rows.map(r => ({
    code: String(r.code ?? ""),
    description: String(r.description ?? ""),
    qty: Number(r.qty ?? 0),
    unitPrice: parseMoney(r.price),
    total: parseMoney(r.total),
    vat: parseMoney(r.vat),
    discount: parseMoney(r.disc),
  }));
}

export interface DaySummary {
  date: string;
  transactions: number;
  gross: Cents;
  tax: Cents;
  discount: Cents;
  returns: number;
  returnValue: Cents;
}

/**
 * Totals for one trading day.
 *
 * Only posted receipts count towards the takings: `posted = 0` means the sale
 * was parked and the money never collected, and including those overstates
 * the day. Drafts are reported separately so they stay visible.
 */
export async function getDaySummary(db: Queryable, date: string): Promise<DaySummary> {
  const row = await db.queryOne<any>(
    `SELECT COUNT(*) AS transactions,
            COALESCE(SUM(IF(is_return = 0, amount, 0)), 0) AS gross,
            COALESCE(SUM(IF(is_return = 0, tax, 0)), 0)    AS tax,
            COALESCE(SUM(IF(is_return = 0, disc, 0)), 0)   AS discount,
            COALESCE(SUM(is_return = 1), 0)                AS returns,
            COALESCE(SUM(IF(is_return = 1, amount, 0)), 0) AS returnValue
       FROM pos_header
      WHERE DATE(trandate) = ? AND posted = 1 AND receiptno <> 'AUTO'`,
    [date],
  );

  return {
    date,
    transactions: Number(row?.transactions ?? 0),
    gross: parseMoney(row?.gross),
    tax: parseMoney(row?.tax),
    discount: parseMoney(row?.discount),
    returns: Number(row?.returns ?? 0),
    returnValue: parseMoney(row?.returnValue),
  };
}

/** How a day's takings were tendered. */
export async function getPaymentMix(
  db: Queryable, date: string,
): Promise<Array<{ method: string; transactions: number; total: Cents }>> {
  const rows = await db.query<any>(
    `SELECT p.payname AS method, COUNT(*) AS transactions, SUM(p.pamount) AS total
       FROM pos_payment_details p
       JOIN pos_header h ON h.receiptno = p.receiptno
      WHERE DATE(h.trandate) = ? AND h.posted = 1 AND h.is_return = 0
      GROUP BY p.payname
      ORDER BY total DESC`,
    [date],
  );

  return rows.map(r => ({
    method: String(r.method ?? "Unknown"),
    transactions: Number(r.transactions ?? 0),
    total: parseMoney(r.total),
  }));
}

/** Best sellers over a date range, by revenue. */
export async function getTopProducts(
  db: Queryable, fromDate: string, toDate: string, limit = 10,
): Promise<Array<{ code: string; description: string; qty: number; revenue: Cents }>> {
  const rows = await db.query<any>(
    `SELECT d.code, MAX(d.description) AS description,
            SUM(d.qty) AS qty,
            SUM(IF(d.inclusive = 'YES', d.total - d.disc, d.total + d.vat - d.disc)) AS revenue
       FROM pos_details d
       JOIN pos_header h ON h.receiptno = d.receiptno
      WHERE DATE(h.trandate) BETWEEN ? AND ?
        AND h.posted = 1 AND h.is_return = 0
      GROUP BY d.code
      ORDER BY revenue DESC
      LIMIT ${Math.min(Math.max(limit, 1), 50)}`,
    [fromDate, toDate],
  );

  return rows.map(r => ({
    code: String(r.code ?? ""),
    description: String(r.description ?? ""),
    qty: Number(r.qty ?? 0),
    revenue: parseMoney(r.revenue),
  }));
}

// ── Suppliers ────────────────────────────────────────────────────

/**
 * Supplier balances.
 *
 * `accounts.prepaid` is the running balance the legacy app maintains per
 * creditor, and `nb` identifies which accounts are creditors.
 */
export async function getSupplierBalances(
  db: Queryable, limit = 100,
): Promise<Array<{ code: string; name: string; balance: Cents }>> {
  const rows = await db.query<any>(
    `SELECT a.code, COALESCE(s.names, a.description) AS name, a.prepaid AS balance
       FROM accounts a
       LEFT JOIN su s ON s.code = a.code
      WHERE a.nb = 'Creditors'
      ORDER BY ABS(COALESCE(a.prepaid, 0)) DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}`,
  );

  return rows.map(r => ({
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
    balance: parseMoney(r.balance),
  }));
}

/**
 * Whether a GL entry balances, by transaction code.
 *
 * The reconciliation check the legacy app never had. Debits must equal
 * credits for every entry; anything else means the books are drifting.
 */
export async function findUnbalancedEntries(
  db: Queryable, fromDate: string, toDate: string, limit = 50,
): Promise<Array<{ trancode: string; trantype: string; net: Cents }>> {
  // Aggregated in a subquery because MySQL will not accept a function of an
  // aggregate alias in HAVING (`HAVING ABS(net)` is rejected).
  const rows = await db.query<any>(
    `SELECT trancode, trantype, net FROM (
        SELECT trancode, trantype, SUM(IF(transign = '+', amount, -amount)) AS net
          FROM journal_transactions
         WHERE jtdate BETWEEN ? AND ?
         GROUP BY trancode, trantype
     ) t
      WHERE ABS(net) > 0.005
      ORDER BY ABS(net) DESC
      LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
    [fromDate, toDate],
  );

  return rows.map(r => ({
    trancode: String(r.trancode ?? ""),
    trantype: String(r.trantype ?? ""),
    net: parseMoney(r.net),
  }));
}
