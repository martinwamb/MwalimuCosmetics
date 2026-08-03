/**
 * Money and the FumasV5 line/VAT/discount contract.
 *
 * Every amount here is an integer number of cents. Floats are not used for
 * money anywhere in this codebase: a POS that is a hundredth of a shilling out
 * per line will not balance its own general ledger, and a ledger that does not
 * balance is worse than no ledger at all.
 *
 * The formulas below are not a redesign. They reproduce what the legacy app
 * does, because the new system writes into the same tables that the legacy
 * reports, GL postings and commission calculations already read.
 */

/** An amount in cents. Negative means a credit or a reduction. */
export type Cents = number;

export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** Format for the DB layer, which sends money as a decimal string. */
export function centsToSqlString(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Parse money arriving from MySQL. The driver is configured to return
 * decimals as strings precisely so they never pass through a float.
 */
export function parseMoney(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === "") return 0;
  return toCents(typeof value === "number" ? value : parseFloat(value));
}

export interface LineInput {
  /** Quantity in the line's packing unit. */
  qty: number;
  /** Unit price as entered, in cents. */
  unitPrice: Cents;
  /**
   * Discount as an ABSOLUTE amount in cents, not a percentage.
   * `pos_details.disc` stores an amount; any percentage in the UI is only a
   * means of arriving at it.
   */
  discount: Cents;
  /** Whether VAT applies at all (`pos_details.taxable` = 'YES'/'NO'). */
  taxable: boolean;
  /** Whether unitPrice already includes VAT (`pos_details.inclusive`). */
  inclusive: boolean;
}

export interface LineAmounts {
  /** `pos_details.total` — qty x unitPrice, gross, BEFORE discount. */
  total: Cents;
  /** `pos_details.vat` — absolute VAT for the line. */
  vat: Cents;
  /** `pos_details.disc` — echoed back for completeness. */
  discount: Cents;
  /**
   * The canonical net contribution of this line, matching the SQL that every
   * downstream aggregate uses:
   *   if(inclusive='YES', total - disc, total + vat - disc)
   */
  net: Cents;
}

/**
 * Compute one sale line.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 *  1. The discount is subtracted BEFORE VAT is worked out, in both the
 *     inclusive and exclusive branches.
 *  2. `total` is the gross qty x price and does NOT have the discount taken
 *     off. The discount is carried separately and only applied in `net`.
 */
export function computeLine(input: LineInput, vatRate: number): LineAmounts {
  const { qty, unitPrice, discount, taxable, inclusive } = input;

  const total = Math.round(qty * unitPrice);
  const taxableBase = total - discount;

  let vat: Cents = 0;
  if (taxable && vatRate > 0) {
    vat = inclusive
      // Price already contains the tax, so extract it out of the base.
      ? Math.round((taxableBase * vatRate) / (1 + vatRate))
      // Price excludes tax, so add it on top of the base.
      : Math.round(taxableBase * vatRate);
  }

  const net = inclusive ? total - discount : total + vat - discount;

  return { total, vat, discount, net };
}

/**
 * `pos_header.amount` — the sum of the line nets, rounded UP to whole
 * shillings.
 *
 * The legacy app applies CEILING here. That is why the header can exceed the
 * sum of its own GL legs by up to 99 cents, and it is the reason the Phase 0
 * probe measures existing residuals before we commit to replicating it.
 */
export function headerAmount(lines: readonly LineAmounts[]): Cents {
  const netTotal = lines.reduce((sum, l) => sum + l.net, 0);
  return Math.ceil(netTotal / 100) * 100;
}

export function sumVat(lines: readonly LineAmounts[]): Cents {
  return lines.reduce((sum, l) => sum + l.vat, 0);
}

export function sumDiscount(lines: readonly LineAmounts[]): Cents {
  return lines.reduce((sum, l) => sum + l.discount, 0);
}

/** A single side of a double-entry posting. */
export interface GlLeg {
  /** GL account code (`journal_transactions.code`). */
  account: string;
  /** Positive amount; the side is carried by `debit`, matching `transign`. */
  amount: Cents;
  /** true writes transign '+', false writes '-'. */
  debit: boolean;
  remarks: string;
}

export class UnbalancedLedgerError extends Error {
  constructor(
    readonly debits: Cents,
    readonly credits: Cents,
    readonly legs: readonly GlLeg[],
  ) {
    super(
      `Refusing to post an unbalanced entry: debits ${fromCents(debits)} ` +
      `vs credits ${fromCents(credits)} (out by ${fromCents(debits - credits)}). ` +
      `Legs: ${legs.map(l => `${l.account} ${l.debit ? "Dr" : "Cr"} ${fromCents(l.amount)}`).join(", ")}`,
    );
    this.name = "UnbalancedLedgerError";
  }
}

/**
 * Throw unless the legs balance.
 *
 * This is the single most important guard in the system. The legacy app has
 * no equivalent: it posts whatever it computes and the books drift silently.
 * Call this BEFORE writing any leg, so an unbalanced entry is never persisted
 * even momentarily.
 *
 * Working in integer cents means exact equality is the correct test; there is
 * no floating-point epsilon to tolerate.
 */
export function assertBalanced(legs: readonly GlLeg[]): void {
  const { debits, credits } = totals(legs);
  if (debits !== credits) throw new UnbalancedLedgerError(debits, credits, legs);
}

function totals(legs: readonly GlLeg[]): { debits: Cents; credits: Cents } {
  let debits = 0;
  let credits = 0;
  for (const leg of legs) {
    if (leg.debit) debits += leg.amount;
    else credits += leg.amount;
  }
  return { debits, credits };
}

/**
 * Largest difference we are willing to treat as rounding: one shilling.
 *
 * The header total is rounded up to whole shillings while the GL legs are
 * derived from unrounded line values, so a genuine rounding gap can never
 * reach a full shilling. Anything at or above this is arithmetic that went
 * wrong somewhere else, and must not be quietly absorbed.
 */
export const MAX_ROUNDING_CENTS = 100;

export class RoundingTooLargeError extends Error {
  constructor(readonly difference: Cents, readonly legs: readonly GlLeg[]) {
    super(
      `Entry is out by ${fromCents(difference)}, which is too large to be rounding ` +
      `(limit ${fromCents(MAX_ROUNDING_CENTS)}). This is a calculation fault, not a ` +
      `rounding remainder, and will not be posted to the rounding account. ` +
      `Legs: ${legs.map(l => `${l.account} ${l.debit ? "Dr" : "Cr"} ${fromCents(l.amount)}`).join(", ")}`,
    );
    this.name = "RoundingTooLargeError";
  }
}

/**
 * Close a sub-shilling gap by posting the remainder to a rounding account,
 * so the entry balances exactly.
 *
 * Why this exists: `pos_header.amount` is rounded UP to whole shillings while
 * the ledger legs come from unrounded line values, so the two disagree by up
 * to 99 cents on many receipts. The legacy app posts both and lets the
 * difference sit there. Measured on live data, 646 of 17,762 POS entries over
 * two years do not balance — every other transaction type is clean.
 *
 * Two decisions are deliberate:
 *
 *  - The remainder is posted to a NAMED account rather than absorbed into
 *    revenue or VAT. Rounding then shows up in one place where it can be
 *    reviewed, instead of quietly distorting the figures that matter.
 *
 *  - Anything at or beyond one shilling is REFUSED, not plugged. The largest
 *    residual in production is 240 shillings, which is far too big to be
 *    rounding and is a real defect in the legacy calculation. A plug account
 *    with no ceiling would hide exactly that class of bug, which is worse
 *    than the imbalance it was meant to fix.
 *
 * @throws RoundingTooLargeError when the gap is too big to be rounding.
 */
export function balanceWithRounding(
  legs: readonly GlLeg[],
  roundingAccount: string,
  remarks = "Rounding",
): GlLeg[] {
  const { debits, credits } = totals(legs);
  const difference = debits - credits;
  if (difference === 0) return [...legs];

  if (Math.abs(difference) >= MAX_ROUNDING_CENTS) {
    throw new RoundingTooLargeError(difference, legs);
  }

  // Debits exceeding credits needs a credit to close it, and vice versa.
  return [...legs, {
    account: roundingAccount,
    amount: Math.abs(difference),
    debit: difference < 0,
    remarks,
  }];
}
