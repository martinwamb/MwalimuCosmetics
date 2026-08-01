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
  let debits = 0;
  let credits = 0;
  for (const leg of legs) {
    if (leg.debit) debits += leg.amount;
    else credits += leg.amount;
  }
  if (debits !== credits) throw new UnbalancedLedgerError(debits, credits, legs);
}
