/**
 * Fetching a receipt for reprinting.
 *
 * Receipts recorded by FumasV5 and by this system live in the same tables, so
 * anything sold on either can be reprinted from here — including sales made
 * years before this application existed.
 *
 * This is cheap, which is worth stating because it is easy to assume
 * otherwise. Checked against the live server: the header lookup is a `const`
 * match on a unique index and the lines and tenders are indexed refs — about
 * six rows in total. It bears no resemblance to the whole-history stock scan
 * that makes the tills hesitate; a reprint costs the server less than a
 * single line being added to a sale.
 */

import type { Queryable } from "../db/connection";
import { parseMoney, type Cents } from "../money";

export interface ReceiptLine {
  code: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: Cents;
  discount: Cents;
  vat: Cents;
  /** Gross line total, before discount, VAT-inclusive per `inclusive`. */
  total: Cents;
  inclusive: boolean;
  taxable: boolean;
}

export interface ReceiptTender {
  method: string;
  amount: Cents;
  reference: string;
}

export interface Receipt {
  receiptNo: string;
  date: string;
  customer: string;
  servedBy: string;
  location: string;
  posted: boolean;
  isReturn: boolean;
  lines: ReceiptLine[];
  tenders: ReceiptTender[];
  subtotal: Cents;
  discount: Cents;
  vat: Cents;
  total: Cents;
  paid: Cents;
  change: Cents;
  /** The amount written out in words, as the legacy app stored it. */
  amountInWords: string;
}

export interface ShopDetails {
  name: string;
  address: string;
  town: string;
  telephone: string;
  email: string;
  vatNumber: string;
  pinNumber: string;
  /** Footer lines from the company record, blanks removed. */
  footer: string[];
}

/**
 * The shop's own details for the receipt head.
 *
 * A single row that changes perhaps once a year, so it is read once and held
 * for the life of the session rather than fetched per reprint.
 */
export async function getShopDetails(db: Queryable): Promise<ShopDetails> {
  const row = await db.queryOne<any>(
    `SELECT society_name, address, town, tel, email, vatno, pinno,
            POS_MESSAGE, POSMESSAGE, line4, line5
       FROM comp LIMIT 1`);

  const text = (v: unknown) => String(v ?? "").trim();
  return {
    name:      text(row?.society_name) || "Mwalimu Cosmetics",
    address:   text(row?.address),
    town:      text(row?.town),
    telephone: text(row?.tel),
    email:     text(row?.email),
    vatNumber: text(row?.vatno),
    pinNumber: text(row?.pinno),
    footer: [text(row?.POS_MESSAGE), text(row?.POSMESSAGE),
             text(row?.line4), text(row?.line5)].filter(Boolean),
  };
}

/**
 * Load one receipt in full.
 *
 * Three indexed lookups. Returns null when the number does not exist, which
 * the caller should treat as "not found" rather than as a failure.
 */
export async function getReceipt(db: Queryable, receiptNo: string): Promise<Receipt | null> {
  const trimmed = receiptNo.trim();
  if (!trimmed) return null;

  const head = await db.queryOne<any>(
    `SELECT receiptno, trandate, posdate, arname, COALESCE(salesref, staff) AS servedby,
            location, posted, is_return, amount, tax, disc, paid, changee, amt_word
       FROM pos_header
      WHERE receiptno = ?
      LIMIT 1`,
    [trimmed]);
  if (!head) return null;

  const lineRows = await db.query<any>(
    `SELECT code, description, qty, nunit, price, total, vat, disc, inclusive, taxable
       FROM pos_details
      WHERE receiptno = ?
      ORDER BY posdid`,
    [trimmed]);

  const tenderRows = await db.query<any>(
    `SELECT payname, pamount, payref
       FROM pos_payment_details
      WHERE receiptno = ?
      ORDER BY paynumber`,
    [trimmed]);

  const yes = (v: unknown) => String(v ?? "").trim().toUpperCase() === "YES";

  const lines: ReceiptLine[] = lineRows.map(r => ({
    code: String(r.code ?? ""),
    description: String(r.description ?? ""),
    qty: Number(r.qty ?? 0),
    unit: String(r.nunit ?? ""),
    unitPrice: parseMoney(r.price),
    discount: parseMoney(r.disc),
    vat: parseMoney(r.vat),
    total: parseMoney(r.total),
    inclusive: yes(r.inclusive),
    taxable: yes(r.taxable),
  }));

  const vat = lines.reduce((s, l) => s + l.vat, 0);
  const discount = lines.reduce((s, l) => s + l.discount, 0);
  // Goods value before tax, however each line was priced.
  const subtotal = lines.reduce(
    (s, l) => s + (l.inclusive ? l.total - l.vat : l.total), 0);

  return {
    receiptNo: String(head.receiptno),
    date: String(head.trandate ?? head.posdate ?? ""),
    customer: String(head.arname ?? "").trim(),
    servedBy: String(head.servedby ?? "").trim(),
    location: String(head.location ?? "").trim(),
    posted: Number(head.posted) === 1,
    isReturn: Number(head.is_return) === 1,
    lines,
    tenders: tenderRows.map(r => ({
      method: String(r.payname ?? "").trim() || "Cash",
      amount: parseMoney(r.pamount),
      reference: String(r.payref ?? "").trim(),
    })),
    subtotal,
    discount,
    vat,
    total: parseMoney(head.amount),
    paid: parseMoney(head.paid),
    change: parseMoney(head.changee),
    amountInWords: String(head.amt_word ?? "").trim(),
  };
}

/**
 * Recent receipts, for finding one without knowing its number.
 *
 * Bounded by date and row count, and driven by the index on trandate.
 */
export async function findRecentReceipts(
  db: Queryable,
  opts: { fromDate: string; toDate: string; search?: string; limit?: number },
): Promise<Array<{ receiptNo: string; date: string; customer: string; total: Cents; posted: boolean }>> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const params: unknown[] = [opts.fromDate, opts.toDate];

  let filter = "";
  if (opts.search) {
    filter = " AND (receiptno LIKE ? OR arname LIKE ?)";
    params.push(`%${opts.search}%`, `%${opts.search}%`);
  }

  const rows = await db.query<any>(
    `SELECT receiptno, trandate, arname, amount, posted
       FROM pos_header
      WHERE DATE(trandate) BETWEEN ? AND ? ${filter}
        AND receiptno <> 'AUTO'
      ORDER BY trandate DESC, posid DESC
      LIMIT ${limit}`,
    params);

  return rows.map(r => ({
    receiptNo: String(r.receiptno),
    date: String(r.trandate ?? ""),
    customer: String(r.arname ?? "").trim(),
    total: parseMoney(r.amount),
    posted: Number(r.posted) === 1,
  }));
}

/** Printer names configured for the tills, so a reprint goes where sales do. */
export async function getPosPrinters(db: Queryable): Promise<string[]> {
  const row = await db.queryOne<any>(
    "SELECT posprinter, posprinter2, posprinter3 FROM pos_settings LIMIT 1");
  if (!row) return [];
  // The legacy app stores UNC paths with backslashes replaced; put them back.
  const restore = (v: unknown) => String(v ?? "").trim().replace(/\//g, "\\");
  return [restore(row.posprinter), restore(row.posprinter2), restore(row.posprinter3)]
    .filter(Boolean);
}
