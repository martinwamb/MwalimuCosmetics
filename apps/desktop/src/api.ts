/**
 * Typed view of the bridge the preload script exposes.
 *
 * Everything the UI can do against the database is listed here. There is no
 * way to send arbitrary SQL from the renderer, which is deliberate.
 */

export interface Check { name: string; ok: boolean; detail: string }
export interface User { usercode: string; username: string; locations: string[]; level: string | null }
export interface MenuEntry { formName: string; caption: string; module: string; section: string }

export interface ItemSummary {
  code: string; description: string; category: string | null;
  retailPrice: number; wholesalePrice: number; cost: number;
  active: boolean; onHand: number;
}

export interface SaleSummary {
  receiptNo: string; date: string; customer: string; staff: string;
  total: number; tax: number; discount: number; posted: boolean; isReturn: boolean;
}

export interface DaySummary {
  date: string; transactions: number; gross: number; tax: number;
  discount: number; returns: number; returnValue: number;
}

export interface AppConfigView {
  mysqlHost: string; mysqlPort: number; mysqlUser: string; mysqlDatabase: string;
  terminalId: string; writesEnabled: boolean; queryPacingMs: number;
  mysqlPasswordSet: boolean;
}

interface Api {
  selfCheck(): Promise<{ checks: Check[]; writesEnabled: boolean }>;
  config: {
    get(): Promise<AppConfigView>;
    save(c: Partial<AppConfigView> & { mysqlPassword?: string }): Promise<AppConfigView>;
    test(c: Partial<AppConfigView> & { mysqlPassword?: string }): Promise<{ version: string; users: number }>;
    path(): Promise<string>;
  };
  auth: {
    login(usercode: string, password: string): Promise<{ user: User; forms: MenuEntry[] }>;
    logout(): Promise<boolean>;
    current(): Promise<User | null>;
    rights(formName: string): Promise<Record<string, boolean>>;
  };
  pos: {
    paymentModes(): Promise<Array<{
      name: string; term: string; account: string; requiresReference: boolean; order: number;
    }>>;
    itemCosts(codes: string[]): Promise<Record<string, number>>;
    postSale(draft: unknown): Promise<{
      receiptNo: string; total: number; vat: number; discount: number;
      change: number; glLegs: number; roundingApplied: number;
    }>;
  };
  receipt: {
    get(receiptNo: string): Promise<any | null>;
    recent(opts: unknown): Promise<any[]>;
    shop(): Promise<any>;
  };
  data: {
    settings(): Promise<any>;
    periodStatus(date: string): Promise<{ year: number; month: number; exists: boolean; locked: boolean }>;
    upcomingPeriodProblems(): Promise<Array<{ year: number; month: number; exists: boolean; locked: boolean }>>;
    searchItems(opts: { search?: string; limit?: number; activeOnly?: boolean }): Promise<ItemSummary[]>;
    lowStock(limit?: number): Promise<Array<ItemSummary & { reorder: number }>>;
    stockMovements(code: string, limit?: number): Promise<Array<{
      date: string; description: string; reference: string;
      location: string; quantity: number; direction: "in" | "out";
    }>>;
    sales(opts: { fromDate: string; toDate: string; limit?: number; includeReturns?: boolean }): Promise<SaleSummary[]>;
    saleLines(receiptNo: string): Promise<Array<{
      code: string; description: string; qty: number;
      unitPrice: number; total: number; vat: number; discount: number;
    }>>;
    daySummary(date: string): Promise<DaySummary>;
    paymentMix(date: string): Promise<Array<{ method: string; transactions: number; total: number }>>;
    dailyTrend(from: string, to: string): Promise<Array<{
      date: string; gross: number; transactions: number;
    }>>;
    topProducts(from: string, to: string, limit?: number): Promise<Array<{
      code: string; description: string; qty: number; revenue: number;
    }>>;
    supplierBalances(limit?: number): Promise<Array<{ code: string; name: string; balance: number }>>;
    unbalancedEntries(from: string, to: string): Promise<Array<{
      trancode: string; trantype: string; net: number;
    }>>;
  };
}

declare global {
  interface Window { mwalimu: Api }
}

export const api: Api = window.mwalimu;

// ── Formatting ───────────────────────────────────────────────────
// Money crosses the boundary as integer cents so it never passes through a
// float; it becomes a string only here, at the point of display.

export function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = (abs / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return negative ? `(${text})` : text;
}

export function shillings(cents: number): string {
  return `KES ${money(cents)}`;
}

export function today(): string {
  // Kenya is UTC+3 year round, so the trading day is derived from that rather
  // than from whatever the machine's clock is set to.
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function daysAgo(n: number): string {
  return new Date(Date.now() + 3 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
}
