/**
 * The bridge between the sandboxed UI and the main process.
 *
 * Only the calls named here exist for the renderer. There is no generic
 * "run this SQL" channel by design: the UI can ask for a supplier balance,
 * but it cannot express a query, so a compromised or careless renderer has
 * nothing dangerous to reach for.
 */

import { contextBridge, ipcRenderer } from "electron";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Unwraps the main process's result envelope into a value or a thrown error. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Result<T>;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

const api = {
  selfCheck: () => call<{
    checks: Array<{ name: string; ok: boolean; detail: string }>;
    writesEnabled: boolean;
  }>("app:selfCheck"),

  config: {
    get:  () => call<any>("config:get"),
    save: (c: unknown) => call<any>("config:save", c),
    test: (c: unknown) => call<{ version: string; users: number }>("config:testConnection", c),
    path: () => call<string>("config:path"),
  },

  auth: {
    login:  (usercode: string, password: string) => call<any>("auth:login", usercode, password),
    logout: () => call<boolean>("auth:logout"),
    current: () => call<any>("auth:current"),
    rights: (formName: string) => call<any>("auth:rights", formName),
  },

  pos: {
    paymentModes: () => call<any[]>("pos:paymentModes"),
    itemCosts:    (codes: string[]) => call<Record<string, number>>("pos:itemCosts", codes),
    postSale:     (draft: unknown) => call<any>("pos:postSale", draft),
  },

  receipt: {
    get:    (receiptNo: string) => call<any>("receipt:get", receiptNo),
    recent: (opts: unknown) => call<any[]>("receipt:recent", opts),
    shop:   () => call<any>("receipt:shop"),
  },

  data: {
    settings:        () => call<any>("data:settings"),
    periodStatus:    (date: string) => call<any>("data:periodStatus", date),
    upcomingPeriodProblems: () => call<any[]>("data:upcomingPeriodProblems"),
    searchItems:     (opts: unknown) => call<any[]>("data:searchItems", opts),
    lowStock:        (limit?: number) => call<any[]>("data:lowStock", limit),
    stockMovements:  (code: string, limit?: number) => call<any[]>("data:stockMovements", code, limit),
    sales:           (opts: unknown) => call<any[]>("data:sales", opts),
    saleLines:       (receiptNo: string) => call<any[]>("data:saleLines", receiptNo),
    daySummary:      (date: string) => call<any>("data:daySummary", date),
    paymentMix:      (date: string) => call<any[]>("data:paymentMix", date),
    dailyTrend:      (from: string, to: string) => call<any[]>("data:dailyTrend", from, to),
    topProducts:     (from: string, to: string, limit?: number) =>
                       call<any[]>("data:topProducts", from, to, limit),
    supplierBalances: (limit?: number) => call<any[]>("data:supplierBalances", limit),
    unbalancedEntries: (from: string, to: string) =>
                       call<any[]>("data:unbalancedEntries", from, to),
  },
};

contextBridge.exposeInMainWorld("mwalimu", api);

export type MwalimuApi = typeof api;
