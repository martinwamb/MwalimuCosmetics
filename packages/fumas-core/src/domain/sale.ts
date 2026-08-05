/**
 * Recording a sale.
 *
 * This is the most consequential code in the system: it writes to the same
 * tables FumasV5 writes to, on a server that is simultaneously running the
 * tills, and it moves money in the books. Two obligations shape all of it.
 *
 * **The books must balance.** Every posting is checked before a single row
 * is written, and an entry whose debits and credits differ is refused. The
 * legacy app has no such check, which is why 646 of its POS entries do not
 * balance.
 *
 * **FumasV5 must keep working.** Both systems share one receipt-number
 * counter and one stock ledger, so the risk is not corruption but blocking:
 * a lock held here is a till waiting there. The transaction is therefore
 * kept as short as it can be, and the one genuinely contended row —
 * `nauto` — is touched in a separate transaction that commits immediately
 * rather than being held for the length of the sale. See allocateReceiptNo.
 */

import type { Database, Transaction } from "../db/connection";
import {
  computeLine, headerAmount, sumVat, sumDiscount,
  assertBalanced, balanceWithRounding, centsToSqlString,
  type Cents, type GlLeg, type LineAmounts,
} from "../money";
import {
  loadSettings, assertPeriodOpen, resolveItemAccounts,
  type Settings, type ItemAccounts,
} from "./settings";

export interface SaleLineInput {
  code: string;
  description: string;
  qty: number;
  unitPrice: Cents;
  discount?: Cents;
  taxable?: boolean;
  inclusive?: boolean;
  /** Packing unit; must exist in `pu` or the stock procedure creates it. */
  unit?: string;
  /** Extended cost of the whole line, NOT a unit cost. */
  buyCostExtended: Cents;
  batchNo?: string;
  serialNo?: string;
}

export interface SaleTenderInput {
  /** Must match a `payname` in pos_payment_mode. */
  method: string;
  amount: Cents;
  reference?: string;
  /** GL account the money lands in, from pos_payment_mode.pdebtorsac. */
  account: string;
}

export interface SaleInput {
  lines: SaleLineInput[];
  tenders: SaleTenderInput[];
  customer?: string;
  customerCode?: string;
  location: string;
  /** Login of the person serving; recorded on the receipt and the audit. */
  staff: string;
  /** Machine name, for the audit trail. */
  terminal: string;
  /** Defaults to today in Kenyan time. */
  date?: string;
}

export interface PostedSale {
  receiptNo: string;
  total: Cents;
  vat: Cents;
  discount: Cents;
  change: Cents;
  glLegs: number;
  roundingApplied: Cents;
}

export class SaleValidationError extends Error {
  constructor(message: string) { super(message); this.name = "SaleValidationError"; }
}

/** Kenya is UTC+3 all year, so the trading day comes from that, not the clock. */
function kenyanToday(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

function kenyanNow(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Take the next receipt number.
 *
 * Deliberately its own short transaction rather than part of the sale.
 *
 * `UPDATE nauto SET pos = pos + 1` locks a row that every till in the shop
 * also needs. Holding that lock for the length of a whole sale — several
 * inserts, the GL postings and a stored procedure call — would make every
 * FumasV5 till queue behind this application. Committing immediately holds
 * it for a millisecond or two instead.
 *
 * The cost is that a sale which fails afterwards leaves a gap in the
 * numbering. That is a fair trade, gaps are harmless, and FumasV5 already
 * behaves this way.
 *
 * The increment is still atomic, so two tills cannot be handed the same
 * number — which the legacy app, reading before updating, can do.
 */
export async function allocateReceiptNo(db: Database, staff: string): Promise<string> {
  return db.withTransaction(async tx => {
    await tx.query("UPDATE nauto SET pos = pos + 1");
    const row = await tx.queryOne<{ receiptno: string }>(
      "SELECT CONCAT(LEFT(?, 1), IFNULL(ppos, ''), pos) AS receiptno FROM nauto LIMIT 1",
      [staff || "W"]);
    if (!row?.receiptno) throw new Error("Could not allocate a receipt number from nauto");
    return String(row.receiptno);
  });
}

export interface PaymentMode {
  /** payname — what appears on the receipt and in pos_payment_details. */
  name: string;
  /** Cash / Bank / Mobile Money / Card. */
  term: string;
  /** GL account the money lands in. */
  account: string;
  /** Whether a reference (M-Pesa code, card slip) must be captured. */
  requiresReference: boolean;
  order: number;
}

/**
 * The tender types the shop accepts, as configured in FumasV5.
 *
 * Read from the shop's own table rather than hardcoded, so the new POS offers
 * exactly what the tills already offer — including the several bank accounts
 * this shop settles into.
 */
export async function getPaymentModes(db: Database): Promise<PaymentMode[]> {
  const rows = await db.query<any>(
    `SELECT payterm, paynumber, payname, pdebtorsac, hasref
       FROM pos_payment_mode
      WHERE payname <> ''
      ORDER BY paynumber`);

  return rows.map(r => ({
    name: String(r.payname ?? "").trim(),
    term: String(r.payterm ?? "").trim(),
    account: String(r.pdebtorsac ?? "").trim(),
    requiresReference: Number(r.hasref) === 1,
    order: Number(r.paynumber ?? 0),
  }));
}

/**
 * Cost per unit for a set of items, for the buy_cost each sale line carries.
 *
 * The shop runs costing mode 0 (standard cost), so this is si.cost. Written
 * as its own function because the mode is a setting: if it ever changes to a
 * ledger-walking mode, this is the one place that has to follow.
 */
export async function getItemCosts(
  db: Database, codes: readonly string[],
): Promise<Map<string, Cents>> {
  const out = new Map<string, Cents>();
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return out;

  const rows = await db.query<any>(
    `SELECT CODE, cost FROM si WHERE CODE IN (${unique.map(() => "?").join(",")})`,
    unique);
  for (const r of rows) {
    out.set(String(r.CODE), Math.round(parseFloat(String(r.cost ?? 0)) * 100) || 0);
  }
  for (const c of unique) if (!out.has(c)) out.set(c, 0);
  return out;
}

interface PreparedLine {
  input: SaleLineInput;
  amounts: LineAmounts;
}

function prepareLines(input: SaleInput, settings: Settings): PreparedLine[] {
  if (!input.lines.length) throw new SaleValidationError("A sale needs at least one line.");

  return input.lines.map(line => {
    if (line.qty <= 0) {
      throw new SaleValidationError(`Quantity must be greater than zero on ${line.code}.`);
    }
    if (line.unitPrice < 0) {
      throw new SaleValidationError(`Price cannot be negative on ${line.code}.`);
    }
    const discount = line.discount ?? 0;
    if (discount > line.qty * line.unitPrice) {
      throw new SaleValidationError(`Discount is larger than the line total on ${line.code}.`);
    }
    return {
      input: line,
      amounts: computeLine({
        qty: line.qty,
        unitPrice: line.unitPrice,
        discount,
        taxable: line.taxable ?? true,
        // Falls back to the shop's own setting rather than assuming.
        inclusive: line.inclusive ?? settings.vatInclusive,
      }, settings.vatRate),
    };
  });
}

/**
 * Build the double entry for a sale.
 *
 * Mirrors what FumasV5 posts, so the two systems' entries are comparable:
 * the money tendered is debited, revenue and VAT credited, discount given
 * debited, and stock relieved into cost of sales.
 */
function buildGlLegs(
  prepared: PreparedLine[],
  tenders: SaleTenderInput[],
  settings: Settings,
  total: Cents,
  accounts: Map<string, ItemAccounts>,
): GlLeg[] {
  const legs: GlLeg[] = [];

  // Money in, per tender, so the cash and bank accounts reconcile by method.
  for (const t of tenders) {
    if (t.amount === 0) continue;
    legs.push({ account: t.account, amount: t.amount, debit: true,
                remarks: `POS ${t.method}` });
  }

  // Change handed back reduces what was actually received.
  const tendered = tenders.reduce((s, t) => s + t.amount, 0);
  const change = Math.max(0, tendered - total);
  if (change > 0) {
    const cashLeg = tenders.find(t => /cash/i.test(t.method)) ?? tenders[0];
    if (cashLeg) {
      legs.push({ account: cashLeg.account, amount: change, debit: false,
                  remarks: "POS change given" });
    }
  }

  const vat = sumVat(prepared.map(p => p.amounts));
  const discount = sumDiscount(prepared.map(p => p.amounts));

  // Grouped by the account each item posts to, so product groups that carry
  // their own revenue or cost-of-sales account land where they should rather
  // than all being swept into one shop-wide total.
  const revenueBy = new Map<string, Cents>();
  const inventoryBy = new Map<string, Cents>();
  const cogsBy = new Map<string, Cents>();
  const add = (m: Map<string, Cents>, key: string, v: Cents) =>
    m.set(key, (m.get(key) ?? 0) + v);

  for (const p of prepared) {
    const acc = accounts.get(p.input.code);
    const net = p.amounts.inclusive
      ? p.amounts.total - p.amounts.vat
      : p.amounts.total;
    if (net !== 0) add(revenueBy, acc?.revenue ?? settings.accounts.revenue ?? "SALES", net);
    if (p.input.buyCostExtended !== 0) {
      add(inventoryBy, acc?.inventory ?? settings.accounts.inventory ?? "INVENTORY",
          p.input.buyCostExtended);
      add(cogsBy, acc?.costOfSales ?? settings.accounts.costOfSales ?? "COGS",
          p.input.buyCostExtended);
    }
  }

  for (const [account, amount] of revenueBy) {
    legs.push({ account, amount, debit: false, remarks: "POS sales" });
  }
  if (vat > 0) {
    legs.push({ account: settings.accounts.vatOutput ?? "VAT-OUTPUT", amount: vat,
                debit: false, remarks: "POS VAT" });
  }
  if (discount > 0) {
    legs.push({ account: settings.accounts.discountGiven ?? "DISCOUNT", amount: discount,
                debit: true, remarks: "POS discount given" });
  }
  // Stock leaves inventory and becomes cost of sales.
  for (const [account, amount] of inventoryBy) {
    legs.push({ account, amount, debit: false, remarks: "POS stock relieved" });
  }
  for (const [account, amount] of cogsBy) {
    legs.push({ account, amount, debit: true, remarks: "POS cost of sales" });
  }

  return legs;
}

/**
 * Record a sale.
 *
 * Everything below happens in one transaction and either all of it lands or
 * none of it does. The receipt number is the one thing taken beforehand, for
 * the locking reason described on allocateReceiptNo.
 */
export async function postSale(db: Database, input: SaleInput): Promise<PostedSale> {
  const date = input.date ?? kenyanToday();

  // Everything that can be checked without holding a lock is checked first,
  // so the transaction opens only when the sale is known to be postable.
  const settings = await loadSettings(db);
  await assertPeriodOpen(db, date);

  const prepared = prepareLines(input, settings);
  const lineAmounts = prepared.map(p => p.amounts);
  const total = headerAmount(lineAmounts);
  const vat = sumVat(lineAmounts);
  const discount = sumDiscount(lineAmounts);

  const tendered = input.tenders.reduce((s, t) => s + t.amount, 0);
  if (tendered < total) {
    throw new SaleValidationError(
      `Tendered ${(tendered / 100).toFixed(2)} is less than the total ${(total / 100).toFixed(2)}.`);
  }
  const change = tendered - total;

  // The books are proved before anything is written, not after.
  const accounts = await resolveItemAccounts(
    db, prepared.map(p => p.input.code), settings);
  let legs = buildGlLegs(prepared, input.tenders, settings, total, accounts);
  const beforeRounding = legs.length;
  legs = balanceWithRounding(legs, settings.accounts.rounding ?? "ROUNDING", "POS rounding");
  const roundingApplied = legs.length > beforeRounding ? legs[legs.length - 1]!.amount : 0;
  assertBalanced(legs);

  const receiptNo = await allocateReceiptNo(db, input.staff);
  const stamp = kenyanNow();

  await db.withTransaction(async tx => {
    await insertHeader(tx, receiptNo, input, date, stamp, total, vat, discount, tendered, change);
    await insertLines(tx, receiptNo, prepared, input);
    await insertTenders(tx, receiptNo, input.tenders);
    await insertGlLegs(tx, receiptNo, legs, date, stamp, input);
    await relieveStock(tx, receiptNo, prepared, input, date);

    // Posted last: until this flips, the receipt is a parked sale, so a
    // failure part-way through cannot leave one that looks complete.
    await tx.query(
      "UPDATE pos_header SET posted = 1, pstaff = ? WHERE receiptno = ?",
      [input.staff, receiptNo]);

    await tx.query(
      `INSERT INTO systemaudit (details, operation, aref, amodule, adate, astaff, amachine, asection)
       VALUES (?, 'ADDED', ?, 'SALES', NOW(), ?, ?, 'Point Of Sale')`,
      [`Sale ${receiptNo} for ${(total / 100).toFixed(2)}`, receiptNo,
       input.staff, input.terminal]);
  });

  return { receiptNo, total, vat, discount, change, glLegs: legs.length, roundingApplied };
}

async function insertHeader(
  tx: Transaction, receiptNo: string, input: SaleInput, date: string, stamp: string,
  total: Cents, vat: Cents, discount: Cents, paid: Cents, change: Cents,
): Promise<void> {
  const method = input.tenders.length > 1 ? "Multiple"
               : (input.tenders[0]?.method ?? "Cash Sale");
  await tx.query(
    `INSERT INTO pos_header
       (receiptno, amount, paid, changee, tax, disc, staff, salesref, arname, arcode,
        posdate, trandate, posted, is_return, location, tyype, csale)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,0)`,
    [receiptNo, centsToSqlString(total), centsToSqlString(paid), centsToSqlString(change),
     centsToSqlString(vat), centsToSqlString(discount),
     input.staff, input.staff, input.customer ?? "Walk-in", input.customerCode ?? "",
     date, stamp, input.location, method]);
}

async function insertLines(
  tx: Transaction, receiptNo: string, prepared: PreparedLine[], input: SaleInput,
): Promise<void> {
  for (const { input: line, amounts } of prepared) {
    await tx.query(
      `INSERT INTO pos_details
         (receiptno, code, description, qty, price, total, disc, vat, taxable, inclusive,
          nunit, buy_cost, location, type, ref_, transign, serialno, cbonus)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'Stocks', ?, '+', ?, 0)`,
      [receiptNo, line.code, line.description, line.qty,
       centsToSqlString(line.unitPrice), centsToSqlString(amounts.total),
       centsToSqlString(amounts.discount), centsToSqlString(amounts.vat),
       amounts.vat > 0 || (line.taxable ?? true) ? "YES" : "NO",
       amounts.inclusive ? "YES" : "NO",
       line.unit ?? "UNITS", centsToSqlString(line.buyCostExtended),
       input.location, line.batchNo ?? "", line.serialNo ?? ""]);
  }
}

async function insertTenders(
  tx: Transaction, receiptNo: string, tenders: SaleTenderInput[],
): Promise<void> {
  let n = 1;
  for (const t of tenders) {
    if (t.amount === 0) continue;
    await tx.query(
      `INSERT INTO pos_payment_details
         (receiptno, paynumber, payname, pamount, payref, pdebtorsac)
       VALUES (?,?,?,?,?,?)`,
      [receiptNo, n++, t.method, centsToSqlString(t.amount), t.reference ?? "", t.account]);
  }
}

async function insertGlLegs(
  tx: Transaction, receiptNo: string, legs: GlLeg[], date: string, stamp: string,
  input: SaleInput,
): Promise<void> {
  for (const leg of legs) {
    await tx.query(
      `INSERT INTO journal_transactions
         (code, remarks, amount, jtdate, trancode, trantype, staff, staffdate,
          transign, rec, r_amt, source)
       VALUES (?,?,?,?,?, 'POS', ?, ?, ?, 'n', 0, ?)`,
      [leg.account || "SUSPENSE", leg.remarks, centsToSqlString(leg.amount), date,
       receiptNo, input.staff, stamp, leg.debit ? "+" : "-", receiptNo]);
  }
}

/**
 * Move the stock.
 *
 * Always through `do_stock_transactions`, never by writing `stran` directly.
 * The procedure also maintains `sq`, the per-item quantity and weighted
 * average cost cache, so a direct insert would leave that cache silently
 * wrong for both systems. Arguments follow the procedure's signature exactly:
 * position 9 is the GL code, which it also stores as the batch number, and
 * position 14 is the direction, '-' for a sale.
 */
async function relieveStock(
  tx: Transaction, receiptNo: string, prepared: PreparedLine[],
  input: SaleInput, date: string,
): Promise<void> {
  for (const { input: line } of prepared) {
    const unitCost = line.qty > 0 ? line.buyCostExtended / line.qty : 0;
    await tx.query(
      "CALL do_stock_transactions(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [line.code, line.description, date, line.qty,
       (unitCost / 100).toFixed(4), (line.buyCostExtended / 100).toFixed(2),
       line.unit ?? "UNITS", "r", line.batchNo ?? "", receiptNo,
       "Cash Sale", "POS", input.location, "-", 0, line.serialNo ?? "", input.staff]);
  }
}
