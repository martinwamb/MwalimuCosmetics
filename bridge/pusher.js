/**
 * Mwalimu Cosmetics — Bridge Sync Agent
 *
 * Runs every 30 seconds. Uses a transaction-count checkpoint to skip
 * the full push when nothing has changed, keeping MySQL load minimal.
 *
 * Data accuracy guarantees:
 *   totalSales  = SUM(pos_header.amount)  — authoritative receipt total
 *   tax         = SUM(pos_header.tax)     — actual VAT per receipt
 *   payment breakdown = pos_payment_details (primary) + tyype fallback
 *     for terminals that don't write to ppd
 *   stock       = SUM(stran.qty) per product — cumulative movement ledger
 *   products    = all unique SKUs ever sold, no 90-day or row-count cutoff
 */

const mysql = require("mysql");
const https = require("https");
const fs    = require("fs");

const MYSQL = {
  host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
  database: "mwalimuinvest", ssl: false, insecureAuth: true, connectTimeout: 8000,
};
const API             = "https://api.mwalimucosmetics.com";
const SECRET          = "mwalimu-sync-secret";
const CHECKPOINT_FILE = "C:\\MwalimuSync\\checkpoint.json";

// Kenya is UTC+3 — always derive the date from local Kenyan wall-clock time
function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function log(msg) { console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${msg}`); }

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r))
  );
}

function apiPost(path, body, secret) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: "api.mwalimucosmetics.com",
      path, method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...(secret ? { "x-sync-secret": secret } : {}),
      },
    }, r => {
      let b = "";
      r.on("data", c => b += c);
      r.on("end", () => res({ status: r.statusCode, body: b }));
    });
    req.on("error", rej);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.write(data); req.end();
  });
}

function apiGet(path, token) {
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: "api.mwalimucosmetics.com",
      path, method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    }, r => {
      let b = "";
      r.on("data", c => b += c);
      r.on("end", () => res({ status: r.statusCode, body: b }));
    });
    req.on("error", rej);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")); }
  catch { return { txCount: -1, date: "", lastProductSync: 0 }; }
}

function saveCheckpoint(cp) {
  try { fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp)); } catch {}
}

async function getSyncToken() {
  const r = await apiPost("/auth/login", {
    email: "wambugujusk@gmail.com", password: "Mwalimu2025!",
  });
  if (r.status === 200) return JSON.parse(r.body).token;
  throw new Error("Auth failed: " + r.body);
}

// ── 1. Push today's metrics ───────────────────────────────────
async function pushMetrics(conn, today) {
  log("Syncing metrics…");

  // pos_header.amount is the authoritative total (what's on the receipt).
  // pos_header.tax is the real VAT recorded by the POS.
  const [summary] = await query(conn,
    `SELECT
       COUNT(*) AS transactions,
       COALESCE(SUM(amount), 0) AS totalSales,
       COALESCE(SUM(tax),    0) AS totalTax
     FROM pos_header
     WHERE DATE(trandate) = ? AND (is_return = 0 OR is_return IS NULL)`,
    [today]);

  // pos_payment_details is the authoritative payment-method breakdown.
  // Some terminals don't write here — handled below with tyype fallback.
  const breakdown = await query(conn,
    `SELECT
       ppd.payname                        AS name,
       COUNT(DISTINCT ppd.receiptno)      AS transactions,
       COALESCE(SUM(ppd.pamount), 0)      AS total
     FROM pos_payment_details ppd
     JOIN pos_header ph ON ppd.receiptno = ph.receiptno
     WHERE DATE(ph.trandate) = ? AND (ph.is_return = 0 OR ph.is_return IS NULL)
     GROUP BY ppd.paynumber, ppd.payname
     ORDER BY total DESC`,
    [today]);

  // Receipts missing from pos_payment_details: classify via tyype.
  // "Cash Sale" → CASH, "Mobile Money" → MPESA, anything else → Other.
  const missing = await query(conn,
    `SELECT ph.tyype, COALESCE(SUM(ph.amount), 0) AS total
     FROM pos_header ph
     LEFT JOIN pos_payment_details ppd ON ph.receiptno = ppd.receiptno
     WHERE DATE(ph.trandate) = ? AND (ph.is_return = 0 OR ph.is_return IS NULL)
       AND ppd.receiptno IS NULL
     GROUP BY ph.tyype`,
    [today]);

  // Aggregate into headline payment figures from both sources
  let cashSales = 0, mpesaSales = 0, otherSales = 0;
  for (const b of breakdown) {
    const t = Number(b.total);
    const n = (b.name || "").toUpperCase();
    if (n === "CASH") cashSales += t;
    else if (n === "MPESA") mpesaSales += t;
    else otherSales += t;
  }
  for (const m of missing) {
    const t    = Number(m.total);
    const type = (m.tyype || "").toLowerCase();
    if (type === "cash sale")    cashSales  += t;
    else if (type === "mobile money") mpesaSales += t;
    else otherSales += t;
  }

  // Top 10 products by revenue today
  const topProducts = await query(conn,
    `SELECT d.code, MAX(d.description) AS name,
            SUM(d.qty) AS qtySold, SUM(d.total) AS revenue
     FROM pos_details d
     JOIN pos_header h ON d.receiptno = h.receiptno
     WHERE DATE(h.trandate) = ? AND (h.is_return = 0 OR h.is_return IS NULL)
       AND d.code IS NOT NULL AND d.code != ''
     GROUP BY d.code
     ORDER BY revenue DESC
     LIMIT 10`,
    [today]);

  // Staff: net sales (sales minus returns) so figures are honest
  const byStaff = await query(conn,
    `SELECT
       staff,
       SUM(CASE WHEN is_return = 0 OR is_return IS NULL THEN 1     ELSE 0 END) AS transactions,
       COALESCE(SUM(CASE WHEN is_return = 0 OR is_return IS NULL THEN amount ELSE 0 END), 0) AS sales,
       COALESCE(SUM(CASE WHEN is_return = 1 THEN amount ELSE 0 END), 0) AS returns
     FROM pos_header
     WHERE DATE(trandate) = ?
     GROUP BY staff
     ORDER BY sales DESC`,
    [today]);

  const r = await apiPost("/sync/metrics", {
    forDate:      today,
    transactions: Number(summary.transactions),
    totalSales:   Number(summary.totalSales),
    tax:          Number(summary.totalTax),
    cashSales,
    mpesaSales,
    otherSales,
    paymentBreakdown: breakdown.map(b => ({
      name:         b.name,
      transactions: Number(b.transactions),
      total:        Number(b.total),
    })),
    topProducts: topProducts.map(p => ({
      code:    p.code,
      name:    p.name,
      qtySold: Number(p.qtySold),
      revenue: Number(p.revenue),
    })),
    byStaff: byStaff.map(s => ({
      staff:        s.staff,
      transactions: Number(s.transactions),
      total:        Number(s.sales),
      returns:      Number(s.returns),
    })),
  }, SECRET);

  if (r.status === 200) {
    log(`Metrics pushed (${summary.transactions} txns, KES ${Number(summary.totalSales).toLocaleString("en-KE")})`);
  } else {
    log(`Metrics push failed [${r.status}]: ${r.body}`);
  }
}

// ── 2. Sync full product catalogue with real stock ────────────
//
// Two separate queries then merged in JS — avoids a slow correlated subquery.
//   Query A: all unique products ever sold (name, price, category)
//   Query B: current stock from stran ledger (SUM of all movements)
//
// Products with stock > 0 are marked ACTIVE; zero/negative → INACTIVE.
// No 90-day filter and no row-count cap: every product the POS knows about
// is synced so the web can sell anything currently in stock.
async function syncProducts(conn) {
  log("Syncing product catalogue…");

  const soldProducts = await query(conn,
    `SELECT
       pd.code              AS sku,
       MAX(pd.description)  AS name,
       MAX(pd.price)        AS price,
       MAX(pd.icateg)       AS category
     FROM pos_details pd
     WHERE pd.code IS NOT NULL AND pd.code != '' AND pd.code != '0'
       AND pd.price > 0
     GROUP BY pd.code`);

  if (!soldProducts.length) { log("No products found."); return; }

  // Full stock ledger — SUM(qty) over all movements gives current balance
  const stockRows = await query(conn,
    `SELECT CODE AS sku, COALESCE(SUM(qty), 0) AS stockQty
     FROM stran
     GROUP BY CODE`);

  const stockMap = Object.create(null);
  for (const s of stockRows) stockMap[s.sku] = Number(s.stockQty);

  const products = soldProducts.map(p => ({
    sku:      p.sku,
    name:     p.name,
    price:    Number(p.price),
    category: p.category || "Uncategorised",
    stockQty: Math.max(0, Math.round(stockMap[p.sku] ?? 0)),
  }));

  // Send in batches of 500 to stay within request limits
  const BATCH = 500;
  let synced = 0;
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const r = await apiPost("/sync/products", { products: batch }, SECRET);
    if (r.status === 200) synced += batch.length;
    else log(`Product batch ${Math.floor(i / BATCH) + 1} failed: ${r.body}`);
  }

  log(`Products synced: ${synced} of ${products.length}`);
}

// ── 3. Apply pending changes from cloud ──────────────────────
//
// Phase 3 placeholder: the cloud queues changes (stock adjustments,
// price corrections, sale voids) that the bridge applies to MySQL.
// Currently handles stock_adjustment; other types will be added here.
async function applyPendingChanges(conn, token) {
  const r = await apiGet("/sync/pending-changes", token);
  if (r.status !== 200) return;

  let changes;
  try { changes = JSON.parse(r.body); } catch { return; }
  if (!changes.length) return;

  log(`Applying ${changes.length} pending change(s) from cloud…`);

  for (const change of changes) {
    try {
      if (change.type === "stock_adjustment") {
        const { sku, delta, name, reason } = change.payload;
        // Insert an adjustment movement into the stran ledger
        await query(conn,
          `INSERT INTO stran (CODE, descr, stdate, qty, tt, trandesc, staff, source)
           VALUES (?, ?, CURDATE(), ?, 'ADJ', ?, 'WEB', 'WEB')`,
          [sku, name || sku, Number(delta), reason || "Web stock adjustment"]);
      }
      // Future types: price_update → UPDATE pos_details/stran, sale_void → etc.

      await apiPost("/sync/mark-change-applied", { id: change.id }, SECRET);
      log(`  Applied [${change.type}]: ${JSON.stringify(change.payload)}`);
    } catch (e) {
      await apiPost("/sync/mark-change-failed", { id: change.id, error: e.message }, SECRET);
      log(`  Failed change ${change.id}: ${e.message}`);
    }
  }
}

// ── 4. Write back web-created sales to MySQL ─────────────────
async function writeBackSales(conn, token) {
  const r = await apiGet("/sync/unsynced-sales", token);
  if (r.status !== 200) { log("Could not fetch unsynced sales: " + r.body); return; }

  let sales;
  try { sales = JSON.parse(r.body); } catch { return; }
  if (!sales.length) { log("No unsynced web sales."); return; }

  log(`Writing ${sales.length} web sale(s) to MySQL…`);

  // Use MAX(CAST(...)) to avoid collisions with non-numeric receipt numbers
  const [maxRct] = await query(conn,
    "SELECT MAX(CAST(receiptno AS UNSIGNED)) AS maxno FROM pos_header");
  let nextNo = (Number(maxRct.maxno) || 0) + 1;

  for (const sale of sales) {
    const rctNo = String(nextNo++).padStart(8, "0");
    const pd    = sale.paymentDetails || {};

    // Kenya local time for the transaction timestamp
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");

    const hasCash  = Number(pd.cash  || 0) > 0;
    const hasMpesa = Number(pd.mpesa || 0) > 0;
    const hasOther = Number(pd.coop || pd.equity_justann || pd.equity_mwalimu || pd.kcb || 0) > 0;
    const tyype = (hasCash && !hasMpesa && !hasOther) ? "Cash Sale"
                : (!hasCash && hasMpesa && !hasOther) ? "Mobile Money"
                : "Multiple";

    try {
      // pos_header
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_header
           (receiptno, amount, paid, changee, tax, staff, arcode, arname, tyype,
            trandate, posdate, cash, mpesa, creditcard, cheque, posted, is_return, disc)
         VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,1,0,0)`,
        [rctNo, sale.total, sale.amountPaid, sale.changeDue,
         sale.staffCode || "WEB", "", "", tyype,
         now.slice(0, 10), now,
         Number(pd.cash  || 0), Number(pd.mpesa || 0), 0, 0],
        (e) => e ? rej(e) : res()
      ));

      // pos_payment_details — so payment breakdown is accurate on next sync
      const ppdPayname = hasMpesa ? "MPESA" : hasOther ? "BANK" : "CASH";
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_payment_details (receiptno, payname, pamount)
         VALUES (?, ?, ?)`,
        [rctNo, ppdPayname, sale.total],
        (e) => e ? rej(e) : res()
      )).catch(() => {}); // ppd insert is best-effort; pos_header is what matters

      // pos_details + stran for each line item
      for (const item of sale.items) {
        await new Promise((res, rej) => conn.query(
          `INSERT INTO pos_details (receiptno, code, description, qty, price, total, vat, posted, disc)
           VALUES (?,?,?,?,?,?,0,1,0)`,
          [rctNo, item.sku, item.productName, item.qty,
           item.unitPrice, item.unitPrice * item.qty],
          (e) => e ? rej(e) : res()
        ));

        // Negative qty = stock going out (sale)
        await new Promise((res, rej) => conn.query(
          `INSERT INTO stran (CODE, descr, stdate, qty, price, total, tt, trandesc, staff, source)
           VALUES (?,?,?,?,?,?,'SALES','SALES',?,'WEB')`,
          [item.sku, item.productName, now.slice(0, 10),
           -item.qty, item.unitPrice, item.unitPrice * item.qty,
           sale.staffCode || "WEB"],
          (e) => e ? rej(e) : res()
        ));
      }

      await apiPost("/sync/mark-synced", { orderId: sale.id, mysqlReceiptNo: rctNo }, SECRET);
      log(`  Written: receipt ${rctNo}, KES ${sale.total}`);
    } catch (e) {
      log(`  Failed to write sale ${sale.id}: ${e.message}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────
async function run() {
  log("=== Mwalimu Sync Agent starting ===");
  const today = kenyanDate();

  const conn = mysql.createConnection(MYSQL);
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));
  log("Connected to MySQL on server-pc.");

  // Count today's transactions to decide whether to push metrics
  const [countRow] = await query(conn,
    `SELECT COUNT(*) AS cnt FROM pos_header WHERE DATE(trandate) = ?`, [today]);
  const currentCount = Number(countRow.cnt);
  const cp = loadCheckpoint();
  const hasNewData = currentCount !== cp.txCount || cp.date !== today;

  // Auth token needed for pending-changes and write-back
  let token;
  try { token = await getSyncToken(); } catch (e) { log("Auth failed: " + e.message); }

  if (hasNewData) {
    await pushMetrics(conn, today).catch(e => log("Metrics error: " + e.message));
  } else {
    log(`No new transactions (${currentCount} today). Metrics skipped.`);
  }

  // Sync products every 10 minutes regardless of transaction changes
  const nowMs = Date.now();
  const productSyncDue = cp.date !== today || nowMs - (cp.lastProductSync || 0) > 10 * 60 * 1000;
  if (productSyncDue) {
    await syncProducts(conn).catch(e => log("Products error: " + e.message));
  }

  if (token) {
    await applyPendingChanges(conn, token).catch(e => log("PendingChanges error: " + e.message));
    await writeBackSales(conn, token).catch(e => log("Writeback error: " + e.message));
  }

  saveCheckpoint({
    txCount:         currentCount,
    date:            today,
    lastProductSync: productSyncDue ? nowMs : (cp.lastProductSync || 0),
  });

  conn.end();
  log("=== Sync complete ===");
}

run().catch(err => { log("Fatal: " + err.message); process.exit(1); });
