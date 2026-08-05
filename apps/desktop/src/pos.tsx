import { useEffect, useState, useMemo } from "react";
import { api, money, today } from "./api";

/**
 * Ringing up a sale, and reprinting one.
 *
 * The sale itself is assembled here but computed and written by the main
 * process: this screen never decides what anything costs, only what the
 * cashier asked for. VAT, discount, rounding and the ledger entry are all
 * worked out on the other side of the bridge, where they are tested.
 */

interface CartLine {
  code: string;
  description: string;
  qty: number;
  unitPrice: number;   // cents
  discount: number;    // cents
  buyCost: number;     // cents, per unit
}

interface PaymentMode {
  name: string; term: string; account: string; requiresReference: boolean; order: number;
}

// ── Selling ──────────────────────────────────────────────────────

export function PointOfSale({ writesEnabled }: { writesEnabled: boolean }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [modes, setModes] = useState<PaymentMode[]>([]);
  const [tenderMethod, setTenderMethod] = useState("");
  const [tenderRef, setTenderRef] = useState("");
  const [tendered, setTendered] = useState("");
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any | null>(null);

  useEffect(() => {
    api.pos.paymentModes()
      .then(m => { setModes(m); if (m.length) setTenderMethod(m[0].name); })
      .catch(e => setError(String(e.message ?? e)));
  }, []);

  // The VAT shown here is indicative only — the authoritative figures come
  // back from the main process when the sale is written.
  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.qty * l.unitPrice - l.discount, 0), [cart]);
  const dueRounded = Math.ceil(subtotal / 100) * 100;
  const tenderedCents = Math.round((parseFloat(tendered || "0") || 0) * 100);
  const change = tenderedCents - dueRounded;

  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setResults(await api.data.searchItems({ search: search.trim(), limit: 25 }));
    } catch (err: any) { setError(String(err.message ?? err)); }
  };

  const addToCart = async (item: any) => {
    try {
      const costs = await api.pos.itemCosts([item.code]);
      setCart(c => {
        const existing = c.findIndex(l => l.code === item.code);
        if (existing >= 0) {
          const next = [...c];
          next[existing] = { ...next[existing]!, qty: next[existing]!.qty + 1 };
          return next;
        }
        return [...c, {
          code: item.code, description: item.description, qty: 1,
          unitPrice: item.retailPrice, discount: 0,
          buyCost: costs[item.code] ?? 0,
        }];
      });
      setResults([]); setSearch("");
    } catch (err: any) { setError(String(err.message ?? err)); }
  };

  const setQty = (code: string, qty: number) =>
    setCart(c => c.map(l => l.code === code ? { ...l, qty: Math.max(0, qty) } : l)
                  .filter(l => l.qty > 0));

  const complete = async () => {
    setBusy(true); setError(null);
    try {
      const mode = modes.find(m => m.name === tenderMethod);
      if (!mode) throw new Error("Choose how the customer is paying.");
      if (mode.requiresReference && !tenderRef.trim()) {
        throw new Error(`${mode.name} needs a reference number.`);
      }
      const result = await api.pos.postSale({
        lines: cart.map(l => ({
          code: l.code, description: l.description, qty: l.qty,
          unitPrice: l.unitPrice, discount: l.discount,
          // Extended across the line, not per unit — the ledger expects the
          // whole line's cost.
          buyCostExtended: l.buyCost * l.qty,
          unit: "UNITS",
        })),
        tenders: [{
          method: mode.name, amount: tenderedCents,
          account: mode.account, reference: tenderRef.trim(),
        }],
        customer: customer.trim() || "Walk-in",
        location: "SHOP",
        date: today(),
      });
      setDone(result);
      setCart([]); setTendered(""); setTenderRef(""); setCustomer("");
    } catch (err: any) {
      setError(String(err.message ?? err));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <>
        <h2>Sale complete</h2>
        <div className="ok-note">
          Receipt <strong>{done.receiptNo}</strong> recorded.
        </div>
        <div className="tiles">
          <div className="tile"><div className="label">Total</div>
            <div className="value">{money(done.total)}</div></div>
          <div className="tile"><div className="label">VAT</div>
            <div className="value">{money(done.vat)}</div></div>
          <div className="tile"><div className="label">Change</div>
            <div className="value">{money(done.change)}</div></div>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {done.glLegs} ledger entries written, balanced
          {done.roundingApplied > 0 && `, with ${money(done.roundingApplied)} posted to rounding`}.
        </p>
        <button className="primary" onClick={() => setDone(null)}>Start the next sale</button>
      </>
    );
  }

  return (
    <>
      <h2>Point of sale</h2>

      {!writesEnabled && (
        <div className="notice">
          <strong>This installation is read-only.</strong> You can build a basket to try the
          screen, but completing a sale is refused. Turn writing on in Settings when you want
          it to record real sales.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <form className="row" onSubmit={doSearch}>
        <div className="field grow">
          <label>Scan or search</label>
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="barcode or product name" autoFocus />
        </div>
        <button className="primary" type="submit">Find</button>
      </form>

      {results.length > 0 && (
        <div className="card">
          <h3>Tap to add</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Product</th><th className="num">Price</th><th className="num">In stock</th></tr></thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.code} className="clickable" onClick={() => addToCart(r)}>
                    <td className="muted">{r.code}</td>
                    <td>{r.description}</td>
                    <td className="num">{money(r.retailPrice)}</td>
                    <td className="num">
                      <span className={`badge ${r.onHand <= 0 ? "bad" : "good"}`}>{r.onHand}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Basket</h3>
        {cart.length === 0 ? <p className="muted">Nothing added yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th className="num">Qty</th><th className="num">Price</th>
                    <th className="num">Line</th><th /></tr>
              </thead>
              <tbody>
                {cart.map(l => (
                  <tr key={l.code}>
                    <td>{l.description}<br /><span className="muted" style={{ fontSize: "0.78rem" }}>{l.code}</span></td>
                    <td className="num" style={{ width: 90 }}>
                      <input type="number" min={1} value={l.qty}
                             onChange={e => setQty(l.code, Number(e.target.value))}
                             style={{ width: 70, textAlign: "right" }} />
                    </td>
                    <td className="num">{money(l.unitPrice)}</td>
                    <td className="num">{money(l.qty * l.unitPrice - l.discount)}</td>
                    <td className="num"><button onClick={() => setQty(l.code, 0)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="card">
          <h3>Payment</h3>
          <div className="row">
            <div className="field grow">
              <label>Customer (optional)</label>
              <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Walk-in" />
            </div>
            <div className="field grow">
              <label>Method</label>
              <select value={tenderMethod} onChange={e => setTenderMethod(e.target.value)}>
                {modes.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            {modes.find(m => m.name === tenderMethod)?.requiresReference && (
              <div className="field grow">
                <label>Reference</label>
                <input value={tenderRef} onChange={e => setTenderRef(e.target.value)}
                       placeholder="M-Pesa code" />
              </div>
            )}
            <div className="field" style={{ width: 150 }}>
              <label>Amount given</label>
              <input type="number" step="0.01" value={tendered}
                     onChange={e => setTendered(e.target.value)} />
            </div>
          </div>

          <div className="tiles">
            <div className="tile"><div className="label">Due</div>
              <div className="value">{money(dueRounded)}</div>
              <div className="sub">rounded up, as the tills do</div></div>
            <div className="tile"><div className="label">Given</div>
              <div className="value">{money(tenderedCents)}</div></div>
            <div className={`tile ${change < 0 ? "" : ""}`}>
              <div className="label">Change</div>
              <div className="value">{change >= 0 ? money(change) : "—"}</div>
              <div className="sub">{change < 0 ? `${money(-change)} short` : ""}</div></div>
          </div>

          <button className="primary" disabled={busy || !writesEnabled || tenderedCents < dueRounded}
                  onClick={complete}>
            {busy ? "Recording…" : "Complete sale"}
          </button>
          {tenderedCents < dueRounded && (
            <span className="muted" style={{ marginLeft: "0.7rem", fontSize: "0.85rem" }}>
              Enter at least {money(dueRounded)}.
            </span>
          )}
        </div>
      )}
    </>
  );
}

// ── Reprinting ───────────────────────────────────────────────────

export function Reprint() {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<any[]>([]);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [shop, setShop] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.receipt.shop().then(setShop).catch(() => undefined);
    load("");
  }, []);

  const load = async (search: string) => {
    setError(null);
    try {
      setRecent(await api.receipt.recent({
        fromDate: new Date(Date.now() + 3 * 3600e3 - 7 * 86400e3).toISOString().slice(0, 10),
        toDate: today(), search: search || undefined, limit: 50,
      }));
    } catch (e: any) { setError(String(e.message ?? e)); }
  };

  const open = async (receiptNo: string) => {
    setError(null);
    try {
      const r = await api.receipt.get(receiptNo);
      if (!r) { setError(`No receipt numbered ${receiptNo}.`); return; }
      setReceipt(r);
    } catch (e: any) { setError(String(e.message ?? e)); }
  };

  return (
    <>
      <h2>Reprint a receipt</h2>
      <p className="muted" style={{ marginTop: "-0.8rem" }}>
        Works for receipts from the old system too — both write to the same records.
      </p>

      {error && <div className="error">{error}</div>}

      <form className="row" onSubmit={e => { e.preventDefault(); load(query.trim()); }}>
        <div className="field grow">
          <label>Receipt number or customer</label>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. JPOS268624" />
        </div>
        <button className="primary" type="submit">Search</button>
        <button type="button" onClick={() => open(query.trim())} disabled={!query.trim()}>
          Open exactly this number
        </button>
      </form>

      <div className="card">
        <h3>Last 7 days</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Receipt</th><th>When</th><th>Customer</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.receiptNo} className="clickable" onClick={() => open(r.receiptNo)}>
                  <td className="muted">{r.receiptNo}</td>
                  <td>{String(r.date).slice(0, 16).replace("T", " ")}</td>
                  <td>{r.customer || "Walk-in"}</td>
                  <td className="num">{money(r.total)}</td>
                  <td>{r.posted ? "" : <span className="badge warn">Parked</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recent.length === 0 && <p className="muted">Nothing found.</p>}
      </div>

      {receipt && <ReceiptView receipt={receipt} shop={shop} onClose={() => setReceipt(null)} />}
    </>
  );
}

function ReceiptView({ receipt, shop, onClose }: { receipt: any; shop: any; onClose: () => void }) {
  // Printing hands the browser engine a plain, narrow document; the operating
  // system's own dialog chooses the printer, so it works with whatever the
  // till already uses without needing to know anything about it.
  const print = () => window.print();

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Receipt {receipt.receiptNo}</h3>
        <span>
          <button className="primary" onClick={print}>Print</button>{" "}
          <button onClick={onClose}>Close</button>
        </span>
      </div>

      <div className="receipt" id="printable-receipt">
        <div className="receipt-head">
          <strong>{shop?.name ?? "Mwalimu Cosmetics"}</strong>
          {shop?.address && <div>{shop.address}</div>}
          {shop?.town && <div>{shop.town}</div>}
          {shop?.telephone && <div>Tel: {shop.telephone}</div>}
          {shop?.pinNumber && <div>PIN: {shop.pinNumber}</div>}
        </div>

        <div className="receipt-meta">
          <div>Receipt: {receipt.receiptNo}</div>
          <div>Date: {String(receipt.date).slice(0, 16).replace("T", " ")}</div>
          <div>Served by: {receipt.servedBy || "—"}</div>
          <div>Customer: {receipt.customer || "Walk-in"}</div>
          {receipt.isReturn && <div><strong>RETURN</strong></div>}
          {!receipt.posted && <div><strong>PARKED — not a completed sale</strong></div>}
        </div>

        <table className="receipt-lines">
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {receipt.lines.map((l: any, i: number) => (
              <tr key={i}>
                <td>{l.description}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{money(l.unitPrice)}</td>
                <td className="num">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="receipt-totals">
          <tbody>
            <tr><td>Subtotal</td><td className="num">{money(receipt.subtotal)}</td></tr>
            {receipt.discount > 0 && <tr><td>Discount</td><td className="num">{money(receipt.discount)}</td></tr>}
            <tr><td>VAT</td><td className="num">{money(receipt.vat)}</td></tr>
            <tr><td><strong>Total</strong></td><td className="num"><strong>{money(receipt.total)}</strong></td></tr>
            {receipt.tenders.map((t: any, i: number) => (
              <tr key={i}><td>{t.method}{t.reference ? ` (${t.reference})` : ""}</td>
                  <td className="num">{money(t.amount)}</td></tr>
            ))}
            {receipt.change > 0 && <tr><td>Change</td><td className="num">{money(receipt.change)}</td></tr>}
          </tbody>
        </table>

        {receipt.amountInWords && <div className="receipt-words">{receipt.amountInWords}</div>}
        {shop?.footer?.map((line: string, i: number) => (
          <div key={i} className="receipt-foot">{line}</div>
        ))}
        <div className="receipt-foot">Reprint — {new Date().toLocaleString("en-KE")}</div>
      </div>
    </div>
  );
}
