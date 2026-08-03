/**
 * Global settings and accounting periods.
 *
 * `nauto` is a single row carrying roughly 150 columns: VAT rate, costing
 * mode, the GL account codes, auto-number counters and assorted flags for
 * every module the vendor ever shipped. It is read once per operation rather
 * than column by column, because the values must be consistent with each
 * other for the duration of a posting.
 */

import type { Queryable } from "../db/connection";

export interface Settings {
  /** Fractional VAT rate, e.g. 0.16. Stored in nauto as a percentage. */
  vatRate: number;
  /** 0 = standard cost from si.cost; anything else walks stran layers. */
  costingMode: number;
  /** Prices already include VAT when true. */
  vatInclusive: boolean;
  /** Refuse to sell more than is in stock when true. */
  checkStock: boolean;
  accounts: {
    vatOutput: string | null;
    discountGiven: string | null;
    inventory: string | null;
    creditors: string | null;
    /** Where sub-shilling rounding differences are posted. */
    rounding: string | null;
  };
  /** Every column, for the few places that need something unusual. */
  raw: Record<string, unknown>;
}

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Read the settings row.
 *
 * `nauto` is expected to hold exactly one row. More than one means whichever
 * the server returns first silently wins, which would make VAT and account
 * codes vary between machines, so that is treated as a fault rather than
 * tolerated.
 */
export async function loadSettings(db: Queryable): Promise<Settings> {
  const rows = await db.query<Record<string, unknown>>("SELECT * FROM nauto LIMIT 2");
  if (rows.length === 0) throw new Error("nauto is empty — global settings are missing");
  if (rows.length > 1) {
    throw new Error("nauto holds more than one row; settings would be ambiguous");
  }
  const r = rows[0]!;

  return {
    // Stored as a percentage; every calculation wants the fraction.
    vatRate: num(r.vat, 16) / 100,
    costingMode: num(r.costmode, 0),
    vatInclusive: num(r.vatinclusive, 0) !== 0,
    checkStock: num(r.CheckQty ?? r.checkqty, 0) !== 0,
    accounts: {
      vatOutput:     str(r.vatoutput ?? r.vat_output),
      discountGiven: str(r.discountgiven ?? r.Discount_in),
      inventory:     str(r.inventory ?? r.Inventory_ac),
      creditors:     str(r.creditors ?? r.creditors_account),
      // The legacy app has no rounding account, because it never balanced
      // the difference. Falls back to a conventional code; the desktop app
      // surfaces this in settings so it can be pointed at the right one.
      rounding:      str(r.roundingac ?? r.rounding_account) ?? "ROUNDING",
    },
    raw: r,
  };
}

export interface PeriodStatus {
  year: number;
  month: number;
  /** False when no row exists for the period at all. */
  exists: boolean;
  locked: boolean;
}

/**
 * Whether a date falls in an open accounting period.
 *
 * A missing row is treated as LOCKED, matching the legacy behaviour. That is
 * the safe direction — posting into a period nobody has opened is worse than
 * being stopped — but it does mean the tills stop dead the moment a new year
 * begins with no rows prepared. The desktop app warns ahead of time rather
 * than discovering it on the first morning of January.
 */
export async function getPeriodStatus(db: Queryable, date: Date | string): Promise<PeriodStatus> {
  const d = typeof date === "string" ? new Date(date + "T12:00:00Z") : date;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  const row = await db.queryOne<{ locked: unknown }>(
    "SELECT locked FROM periods WHERE yr = ? AND period = ? LIMIT 1",
    [year, month],
  );

  if (!row) return { year, month, exists: false, locked: true };

  const v = String(row.locked ?? "").trim().toUpperCase();
  return { year, month, exists: true, locked: v === "1" || v === "YES" || v === "Y" || v === "TRUE" };
}

export class PeriodLockedError extends Error {
  constructor(readonly status: PeriodStatus) {
    super(status.exists
      ? `Accounting period ${status.month}/${status.year} is locked; nothing can be posted into it.`
      : `Accounting period ${status.month}/${status.year} has no row in \`periods\`, so it is treated as locked. ` +
        `Create the period before posting.`);
    this.name = "PeriodLockedError";
  }
}

export async function assertPeriodOpen(db: Queryable, date: Date | string): Promise<void> {
  const status = await getPeriodStatus(db, date);
  if (status.locked) throw new PeriodLockedError(status);
}

/**
 * Periods in the next `days` that are missing or locked.
 *
 * Used to warn before trading stops rather than after. The legacy app gave no
 * notice at all.
 */
export async function findUpcomingPeriodProblems(
  db: Queryable,
  days = 45,
): Promise<PeriodStatus[]> {
  const problems: PeriodStatus[] = [];
  const seen = new Set<string>();

  for (let i = 0; i <= days; i += 1) {
    const d = new Date(Date.now() + i * 86400000);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const status = await getPeriodStatus(db, d);
    if (status.locked) problems.push(status);
  }
  return problems;
}
