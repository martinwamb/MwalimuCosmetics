import { useEffect, useState, type ReactNode } from "react";
import {
  api, money, shillings, today, daysAgo,
  type ItemSummary, type SaleSummary, type DaySummary, type AppConfigView,
} from "./api";

/** Runs an async load, surfacing errors rather than leaving a blank panel. */
function useLoader<T>(load: () => Promise<T>, deps: unknown[]): {
  data: T | null; error: string | null; loading: boolean; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload: () => setTick(t => t + 1) };
}

function Panel({ loading, error, children }: {
  loading: boolean; error: string | null; children: ReactNode;
}) {
  if (error) return <div className="error">{error}</div>;
  if (loading) return <p className="muted">Loading…</p>;
  return <>{children}</>;
}

// ── Dashboard ────────────────────────────────────────────────────

export function Dashboard() {
  const [date, setDate] = useState(today());

  const day = useLoader<DaySummary>(() => api.data.daySummary(date), [date]);
  const mix = useLoader(() => api.data.paymentMix(date), [date]);
  const top = useLoader(() => api.data.topProducts(daysAgo(7), date, 8), [date]);
  const low = useLoader(() => api.data.lowStock(8), []);
  const periods = useLoader(() => api.data.upcomingPeriodProblems(), []);
  const unbalanced = useLoader(() => api.data.unbalancedEntries(daysAgo(7), date), [date]);

  const d = day.data;
  const net = d ? d.gross - d.returnValue : 0;

  return (
    <>
      <h2>Dashboard</h2>

      <div className="row">
        <div className="field">
          <label>Trading day</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button onClick={() => { day.reload(); mix.reload(); top.reload(); }}>Refresh</button>
      </div>

      {/* Periods fail closed, so a missing row stops the tills. Better to warn
          weeks ahead than to discover it on the first morning of a month. */}
      {periods.data && periods.data.length > 0 && (
        <div className="notice">
          <strong>Accounting periods need attention.</strong>{" "}
          {periods.data.map(p => `${p.month}/${p.year}`).join(", ")}{" "}
          {periods.data.some(p => !p.exists)
            ? "— some have no row at all, which counts as locked. Nothing can be posted into them until they are created."
            : "— locked, so nothing can be posted into them."}
        </div>
      )}

      {unbalanced.data && unbalanced.data.length > 0 && (
        <div className="notice">
          <strong>{unbalanced.data.length} ledger {unbalanced.data.length === 1 ? "entry" : "entries"} in the last 7 days
          {" "}{unbalanced.data.length === 1 ? "does" : "do"} not balance.</strong>{" "}
          Debits and credits differ. These come from the old system; the new one refuses to post an entry that does not balance.
        </div>
      )}

      <Panel loading={day.loading} error={day.error}>
        <div className="tiles">
          <div className="tile good">
            <div className="label">Takings</div>
            <div className="value">{d ? money(net) : "—"}</div>
            <div className="sub">{d?.transactions ?? 0} receipts, posted only</div>
          </div>
          <div className="tile">
            <div className="label">VAT</div>
            <div className="value">{d ? money(d.tax) : "—"}</div>
            <div className="sub">included in takings</div>
          </div>
          <div className="tile warn">
            <div className="label">Discounts</div>
            <div className="value">{d ? money(d.discount) : "—"}</div>
            <div className="sub">given away today</div>
          </div>
          <div className="tile bad">
            <div className="label">Returns</div>
            <div className="value">{d ? money(d.returnValue) : "—"}</div>
            <div className="sub">{d?.returns ?? 0} returned</div>
          </div>
        </div>
      </Panel>

      <div className="card">
        <h3>How today was paid</h3>
        <Panel loading={mix.loading} error={mix.error}>
          {mix.data && mix.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Method</th><th className="num">Receipts</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {mix.data.map(m => (
                    <tr key={m.method}>
                      <td>{m.method}</td>
                      <td className="num">{m.transactions}</td>
                      <td className="num">{money(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Nothing taken on this day.</p>}
        </Panel>
      </div>

      <div className="card">
        <h3>Best sellers, last 7 days</h3>
        <Panel loading={top.loading} error={top.error}>
          {top.data && top.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Product</th><th className="num">Sold</th><th className="num">Revenue</th></tr></thead>
                <tbody>
                  {top.data.map(t => (
                    <tr key={t.code}>
                      <td className="muted">{t.code}</td>
                      <td>{t.description}</td>
                      <td className="num">{t.qty}</td>
                      <td className="num">{money(t.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No sales in this period.</p>}
        </Panel>
      </div>

      <div className="card">
        <h3>Running low</h3>
        <Panel loading={low.loading} error={low.error}>
          {low.data && low.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Product</th><th className="num">On hand</th></tr></thead>
                <tbody>
                  {low.data.map(i => (
                    <tr key={i.code}>
                      <td className="muted">{i.code}</td>
                      <td>{i.description}</td>
                      <td className="num"><span className={`badge ${i.onHand <= 0 ? "bad" : "warn"}`}>{i.onHand}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Nothing at or below its reorder level.</p>}
        </Panel>
      </div>
    </>
  );
}

// ── Items and stock ──────────────────────────────────────────────

export function Items() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ItemSummary | null>(null);

  const items = useLoader<ItemSummary[]>(
    () => api.data.searchItems({ search: query || undefined, limit: 100 }), [query]);
  const moves = useLoader(
    () => selected ? api.data.stockMovements(selected.code, 25) : Promise.resolve([]), [selected?.code]);

  return (
    <>
      <h2>Items &amp; stock</h2>

      <form className="row" onSubmit={e => { e.preventDefault(); setQuery(search); }}>
        <div className="field grow">
          <label>Search by code or description</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. lotion" />
        </div>
        <button className="primary" type="submit">Search</button>
      </form>

      <div className="card">
        <h3>{items.data ? `${items.data.length} items` : "Items"}</h3>
        <Panel loading={items.loading} error={items.error}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Description</th><th>Category</th>
                  <th className="num">Retail</th><th className="num">Wholesale</th>
                  <th className="num">Cost</th><th className="num">On hand</th>
                </tr>
              </thead>
              <tbody>
                {items.data?.map(i => (
                  <tr key={i.code} className="clickable" onClick={() => setSelected(i)}>
                    <td className="muted">{i.code}</td>
                    <td>{i.description}</td>
                    <td className="muted">{i.category ?? "—"}</td>
                    <td className="num">{money(i.retailPrice)}</td>
                    <td className="num">{money(i.wholesalePrice)}</td>
                    <td className="num">{money(i.cost)}</td>
                    <td className="num">
                      <span className={`badge ${i.onHand <= 0 ? "bad" : "good"}`}>{i.onHand}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.data?.length === 0 && <p className="muted">Nothing matched.</p>}
        </Panel>
      </div>

      {selected && (
        <div className="card">
          <h3>Recent movements — {selected.description}</h3>
          <Panel loading={moves.loading} error={moves.error}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Movement</th><th>Reference</th><th>Location</th><th className="num">Qty</th></tr>
                </thead>
                <tbody>
                  {moves.data?.map((m, idx) => (
                    <tr key={idx}>
                      <td>{String(m.date).slice(0, 10)}</td>
                      <td>{m.description}</td>
                      <td className="muted">{m.reference}</td>
                      <td className="muted">{m.location}</td>
                      <td className="num">
                        <span className={`badge ${m.direction === "in" ? "good" : "bad"}`}>
                          {m.direction === "in" ? "+" : "−"}{m.quantity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {moves.data?.length === 0 && <p className="muted">No movements recorded.</p>}
          </Panel>
        </div>
      )}
    </>
  );
}

// ── Sales ────────────────────────────────────────────────────────

export function Sales() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [includeReturns, setIncludeReturns] = useState(true);
  const [selected, setSelected] = useState<SaleSummary | null>(null);

  const sales = useLoader<SaleSummary[]>(
    () => api.data.sales({ fromDate: from, toDate: to, limit: 200, includeReturns }),
    [from, to, includeReturns]);
  const lines = useLoader(
    () => selected ? api.data.saleLines(selected.receiptNo) : Promise.resolve([]), [selected?.receiptNo]);

  return (
    <>
      <h2>Sales</h2>

      <div className="row">
        <div className="field"><label>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="field">
          <label>Returns</label>
          <button onClick={() => setIncludeReturns(v => !v)}>
            {includeReturns ? "Shown" : "Hidden"}
          </button>
        </div>
        <button onClick={() => sales.reload()}>Refresh</button>
      </div>

      <div className="card">
        <h3>{sales.data ? `${sales.data.length} receipts` : "Receipts"}</h3>
        <Panel loading={sales.loading} error={sales.error}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Receipt</th><th>Date</th><th>Customer</th><th>Served by</th>
                  <th className="num">VAT</th><th className="num">Total</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.data?.map(s => (
                  <tr key={s.receiptNo} className="clickable" onClick={() => setSelected(s)}>
                    <td className="muted">{s.receiptNo}</td>
                    <td>{String(s.date).slice(0, 16).replace("T", " ")}</td>
                    <td>{s.customer || "—"}</td>
                    <td className="muted">{s.staff}</td>
                    <td className="num">{money(s.tax)}</td>
                    <td className="num">{money(s.total)}</td>
                    <td>
                      {s.isReturn && <span className="badge bad">Return</span>}
                      {!s.isReturn && (s.posted
                        ? <span className="badge good">Posted</span>
                        // Parked: the sale was started but the money never
                        // collected, so it is not part of the takings.
                        : <span className="badge warn">Parked</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sales.data?.length === 0 && <p className="muted">No receipts in this range.</p>}
        </Panel>
      </div>

      {selected && (
        <div className="card">
          <h3>Receipt {selected.receiptNo}</h3>
          <Panel loading={lines.loading} error={lines.error}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Description</th><th className="num">Qty</th>
                    <th className="num">Price</th><th className="num">Discount</th>
                    <th className="num">VAT</th><th className="num">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.data?.map((l, idx) => (
                    <tr key={idx}>
                      <td className="muted">{l.code}</td>
                      <td>{l.description}</td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{money(l.unitPrice)}</td>
                      <td className="num">{money(l.discount)}</td>
                      <td className="num">{money(l.vat)}</td>
                      <td className="num">{money(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

// ── Suppliers ────────────────────────────────────────────────────

export function Suppliers() {
  const balances = useLoader(() => api.data.supplierBalances(200), []);
  const total = balances.data?.reduce((sum, s) => sum + s.balance, 0) ?? 0;

  return (
    <>
      <h2>Suppliers</h2>
      <div className="tiles">
        <div className="tile warn">
          <div className="label">Owed to suppliers</div>
          <div className="value">{money(total)}</div>
          <div className="sub">{balances.data?.length ?? 0} creditor accounts</div>
        </div>
      </div>

      <div className="card">
        <h3>Balances</h3>
        <Panel loading={balances.loading} error={balances.error}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Supplier</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {balances.data?.map(s => (
                  <tr key={s.code}>
                    <td className="muted">{s.code}</td>
                    <td>{s.name}</td>
                    <td className="num">{money(s.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {balances.data?.length === 0 && <p className="muted">No creditor accounts found.</p>}
        </Panel>
      </div>
    </>
  );
}

// ── Settings ─────────────────────────────────────────────────────

export function Settings() {
  const [form, setForm] = useState<Partial<AppConfigView> & { mysqlPassword?: string }>({});
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("");

  const cfg = useLoader<AppConfigView>(() => api.config.get(), []);
  const settings = useLoader(() => api.data.settings().catch(() => null), []);

  useEffect(() => { if (cfg.data) setForm({ ...cfg.data }); }, [cfg.data]);
  useEffect(() => { api.config.path().then(setPath).catch(() => undefined); }, []);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const test = async () => {
    setBusy(true); setStatus(null);
    try {
      const r = await api.config.test(form);
      setStatus({ kind: "ok", text: `Connected to MySQL ${r.version} — ${r.users} user accounts found.` });
    } catch (e: any) {
      setStatus({ kind: "err", text: String(e.message ?? e) });
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setStatus(null);
    try {
      await api.config.save(form);
      setStatus({ kind: "ok", text: "Saved. Sign out and back in for it to take effect everywhere." });
    } catch (e: any) {
      setStatus({ kind: "err", text: String(e.message ?? e) });
    } finally { setBusy(false); }
  };

  return (
    <>
      <h2>Settings</h2>

      {status && <div className={status.kind === "ok" ? "ok-note" : "error"}>{status.text}</div>}

      <div className="card">
        <h3>Database connection</h3>
        <div className="row">
          <div className="field grow"><label>Server</label>
            <input value={form.mysqlHost ?? ""} onChange={e => set("mysqlHost", e.target.value)} /></div>
          <div className="field" style={{ width: 110 }}><label>Port</label>
            <input type="number" value={form.mysqlPort ?? 3306}
                   onChange={e => set("mysqlPort", Number(e.target.value))} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Username</label>
            <input value={form.mysqlUser ?? ""} onChange={e => set("mysqlUser", e.target.value)} /></div>
          <div className="field grow"><label>Password</label>
            <input type="password" placeholder={cfg.data?.mysqlPasswordSet ? "unchanged" : ""}
                   onChange={e => set("mysqlPassword", e.target.value)} /></div>
        </div>
        <div className="field"><label>Database</label>
          <input value={form.mysqlDatabase ?? ""} onChange={e => set("mysqlDatabase", e.target.value)} /></div>

        <div className="row">
          <button onClick={test} disabled={busy}>Test connection</button>
          <button className="primary" onClick={save} disabled={busy}>Save</button>
        </div>
        <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
          Stored on this machine at {path || "…"} — never inside the application itself.
        </p>
      </div>

      <div className="card">
        <h3>This installation</h3>
        <div className="row">
          <div className="field grow"><label>Terminal name</label>
            <input value={form.terminalId ?? ""} onChange={e => set("terminalId", e.target.value)} /></div>
          <div className="field" style={{ width: 190 }}>
            <label>Pause between queries (ms)</label>
            <input type="number" value={form.queryPacingMs ?? 50}
                   onChange={e => set("queryPacingMs", Number(e.target.value))} /></div>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          The shop's server also runs the tills. A small pause between queries keeps
          browsing here from slowing down a queue at the counter. Raise it if the tills feel sluggish.
        </p>

        <div className="field">
          <label>Writing to the database</label>
          <button onClick={() => set("writesEnabled", !form.writesEnabled)}>
            {form.writesEnabled ? "Enabled" : "Disabled — read only"}
          </button>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
          Off by default so a new installation can be explored against the real data
          with no possibility of changing anything.
        </p>
      </div>

      {settings.data && (
        <div className="card">
          <h3>Values read from the shop's settings</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><th>VAT rate</th><td>{(settings.data.vatRate * 100).toFixed(2)}%</td></tr>
                <tr><th>Prices include VAT</th><td>{settings.data.vatInclusive ? "Yes" : "No"}</td></tr>
                <tr><th>Costing method</th>
                    <td>{settings.data.costingMode === 0 ? "Standard cost" : `Ledger layers (mode ${settings.data.costingMode})`}</td></tr>
                <tr><th>Block overselling</th><td>{settings.data.checkStock ? "Yes" : "No"}</td></tr>
                <tr><th>Rounding account</th><td>{settings.data.accounts?.rounding ?? "—"}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
