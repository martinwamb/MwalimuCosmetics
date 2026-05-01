/**
 * Mwalimu Cosmetics — Bridge Sync Agent
 * Version: 20260501-2
 *
 * Runs every 30 seconds via loop.ps1 / Task Scheduler.
 * Checks for a newer version from the server on every startup and self-updates.
 *
 * Data guarantees:
 *   totalSales     = SUM(pos_header.amount) WHERE posted=1 (confirmed paid only)
 *   draftSales     = SUM(pos_header.amount) WHERE posted=0 (unposted, money not received)
 *   tax            = SUM(pos_header.tax) WHERE posted=1
 *   purchases      = SUM(grn.gtotal) WHERE posted=1 (stock received today at cost)
 *   profit         = revenue from pos_details minus latest cost from grn_d per SKU
 *   payment breakdown = pos_payment_details (primary) + tyype fallback
 *   stock          = SUM(stran.qty) per product — full cumulative ledger
 *   products       = all unique SKUs ever sold, no date or row-count cutoff
 */

const mysql = require("mysql");
const https = require("https");
const http  = require("http");
const fs    = require("fs");

const AGENT_VERSION   = "20260501-2";
const MYSQL = {
  host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
  database: "mwalimuinvest", ssl: false, insecureAuth: true, connectTimeout: 8000,
};
const API             = "https://api.mwalimucosmetics.com";
const SECRET          = "mwalimu-sync-secret";
const CHECKPOINT_FILE = "C:\\MwalimuSync\\checkpoint.json";
const SELF_PATH       = "C:\\MwalimuSync\\pusher.js";

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function log(msg) { console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${msg}`); }

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r))
  );
}

function apiRequest(method, path, body, secret, token, timeoutMs) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: "api.mwalimucosmetics.com",
      path, method,
      headers: {
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        ...(secret ? { "x-sync-secret": secret } : {}),
        ...(token  ? { "Authorization": `Bearer ${token}` } : {}),
      },
    }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => res({ status: r.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", rej);
    req.setTimeout(timeoutMs || 20000, () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

const apiPost      = (path, body, secret, token) => apiRequest("POST", path, body, secret, token);
const apiPostLarge = (path, body, secret)        => apiRequest("POST", path, body, secret, null, 120000);
const apiGet       = (path, token)               => apiRequest("GET",  path, null,  null,  token);

function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")); }
  catch { return { txCount: -1, date: "", lastProductSync: 0 }; }
}
function saveCheckpoint(cp) {
  try { fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp)); } catch {}
}

// ── Self-update ───────────────────────────────────────────────
// Fetches the server's current agent version. If different, downloads
// the new pusher.js, overwrites this file, and re-spawns the process.
async function checkForUpdate() {
  try {
    const r = await apiGet("/sync/agent-version", null);
    if (r.status !== 200) return;
    const { version } = JSON.parse(r.body);
    if (version === AGENT_VERSION) return;

    log(`New agent version available (${version}). Downloading…`);
    const dl = await apiGet("/sync/agent/pusher.js", null);
    if (dl.status !== 200) { log("Download failed: " + dl.status); return; }

    fs.writeFileSync(SELF_PATH, dl.body, "utf8");
    log("Agent updated. Restarting…");
    require("child_process").spawn(process.execPath, [SELF_PATH], {
      detached: true, stdio: "inherit",
    }).unref();
    process.exit(0);
  } catch (e) {
    log("Update check failed (non-fatal): " + e.message);
  }
}

async function getSyncToken() {
  const r = await apiPost("/auth/login", { email: "wambugujusk@gmail.com", password: "Mwalimu2025!" });
  if (r.status === 200) return JSON.parse(r.body).token;
  throw new Error("Auth failed: " + r.body);
}

// ── 1. Push today's metrics ───────────────────────────────────
async function pushMetrics(conn, today) {
  log("Syncing metrics…");

  // Confirmed paid sales only (posted=1)
  const [paid] = await query(conn,
    `SELECT COUNT(*) AS transactions,
            COALESCE(SUM(amount), 0) AS totalSales,
            COALESCE(SUM(tax),    0) AS totalTax
     FROM pos_header
     WHERE DATE(trandate) = ? AND posted = 1 AND (is_return = 0 OR is_return IS NULL)`,
    [today]);

  // Unposted drafts (posted=0) — money not yet received
  const [draft] = await query(conn,
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(amount), 0) AS totalSales
     FROM pos_header
     WHERE DATE(trandate) = ? AND posted = 0 AND (is_return = 0 OR is_return IS NULL)`,
    [today]);

  // GRN purchases: stock received today at cost price
  const [grn] = await query(conn,
    `SELECT COALESCE(SUM(gtotal), 0) AS purchases
     FROM grn WHERE DATE(ddate) = ? AND posted = 1`,
    [today]);

  // Gross profit — 2-step to avoid N correlated subqueries
  const soldItems = await query(conn,
    `SELECT pd.code, SUM(pd.qty) AS qty, ROUND(SUM(pd.total), 0) AS revenue
     FROM pos_details pd
     JOIN pos_header ph ON pd.receiptno = ph.receiptno
     WHERE DATE(ph.trandate) = ? AND ph.posted = 1
       AND (ph.is_return = 0 OR ph.is_return IS NULL)
       AND pd.code IS NOT NULL AND pd.code != ''
     GROUP BY pd.code`,
    [today]);

  let profit = 0;
  if (soldItems.length > 0) {
    const codes = soldItems.map(i => i.code);
    // Get the most-recent cost per code from GRN receipts
    const costRows = await query(conn,
      `SELECT d.code, d.uprice AS cost
       FROM grn_d d JOIN grn g ON d.no = g.no
       WHERE d.code IN (?) AND g.posted = 1
       ORDER BY g.ddate DESC`,
      [codes]);

    const costMap = Object.create(null);
    for (const r of costRows) {
      if (!(r.code in costMap)) costMap[r.code] = Number(r.cost);
    }

    for (const item of soldItems) {
      const revenue = Number(item.revenue);
      const qty     = Number(item.qty);
      if (item.code in costMap) {
        profit += revenue - costMap[item.code] * qty;
      }
      // No cost data → exclude from profit (conservative; don't guess)
    }
    profit = Math.round(profit);
  }

  // Payment breakdown from pos_payment_details (primary source)
  const breakdown = await query(conn,
    `SELECT ppd.payname AS name,
            COUNT(DISTINCT ppd.receiptno) AS transactions,
            COALESCE(SUM(ppd.pamount), 0) AS total
     FROM pos_payment_details ppd
     JOIN pos_header ph ON ppd.receiptno = ph.receiptno
     WHERE DATE(ph.trandate) = ? AND ph.posted = 1
       AND (ph.is_return = 0 OR ph.is_return IS NULL)
     GROUP BY ppd.paynumber, ppd.payname
     ORDER BY total DESC`,
    [today]);

  // Fallback for receipts missing from pos_payment_details
  const missing = await query(conn,
    `SELECT ph.tyype, COALESCE(SUM(ph.amount), 0) AS total
     FROM pos_header ph
     LEFT JOIN pos_payment_details ppd ON ph.receiptno = ppd.receiptno
     WHERE DATE(ph.trandate) = ? AND ph.posted = 1
       AND (ph.is_return = 0 OR ph.is_return IS NULL)
       AND ppd.receiptno IS NULL
     GROUP BY ph.tyype`,
    [today]);

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
    if (type === "cash sale")        cashSales  += t;
    else if (type === "mobile money") mpesaSales += t;
    else                              otherSales += t;
  }

  // Top 10 products by revenue (posted sales only)
  const topProducts = await query(conn,
    `SELECT d.code, MAX(d.description) AS name,
            SUM(d.qty) AS qtySold, ROUND(SUM(d.total), 0) AS revenue
     FROM pos_details d
     JOIN pos_header h ON d.receiptno = h.receiptno
     WHERE DATE(h.trandate) = ? AND h.posted = 1
       AND (h.is_return = 0 OR h.is_return IS NULL)
       AND d.code IS NOT NULL AND d.code != ''
     GROUP BY d.code ORDER BY revenue DESC LIMIT 10`,
    [today]);

  // Staff: net sales and returns shown separately
  const byStaff = await query(conn,
    `SELECT staff,
       SUM(CASE WHEN posted = 1 AND (is_return = 0 OR is_return IS NULL) THEN 1     ELSE 0 END) AS transactions,
       COALESCE(SUM(CASE WHEN posted = 1 AND (is_return = 0 OR is_return IS NULL) THEN amount ELSE 0 END), 0) AS sales,
       COALESCE(SUM(CASE WHEN is_return = 1 THEN amount ELSE 0 END), 0) AS returns
     FROM pos_header WHERE DATE(trandate) = ?
     GROUP BY staff ORDER BY sales DESC`,
    [today]);

  const r = await apiPost("/sync/metrics", {
    forDate:           today,
    transactions:      Number(paid.transactions),
    totalSales:        Number(paid.totalSales),
    tax:               Number(paid.totalTax),
    cashSales,
    mpesaSales,
    otherSales,
    draftTransactions: Number(draft.transactions),
    draftSales:        Number(draft.totalSales),
    purchases:         Number(grn.purchases),
    profit,
    paymentBreakdown:  breakdown.map(b => ({ name: b.name, transactions: Number(b.transactions), total: Number(b.total) })),
    topProducts:       topProducts.map(p => ({ code: p.code, name: p.name, qtySold: Number(p.qtySold), revenue: Number(p.revenue) })),
    byStaff:           byStaff.map(s => ({ staff: s.staff, transactions: Number(s.transactions), total: Number(s.sales), returns: Number(s.returns) })),
  }, SECRET);

  if (r.status === 200) {
    log(`Metrics pushed — ${paid.transactions} txns, KES ${Number(paid.totalSales).toLocaleString("en-KE")} sales, KES ${profit.toLocaleString("en-KE")} profit`);
  } else {
    log(`Metrics push failed [${r.status}]: ${r.body}`);
  }
}

// ── 2. Sync full product catalogue with real stock ────────────
// Heavy queries — runs at most once per hour to protect MySQL.
async function syncProducts(conn) {
  log("Syncing product catalogue…");

  // All unique SKUs ever sold: name, price, category
  const soldProducts = await query(conn,
    `SELECT pd.code AS sku, MAX(pd.description) AS name,
            MAX(pd.price) AS price, MAX(pd.icateg) AS category
     FROM pos_details pd
     WHERE pd.code IS NOT NULL AND pd.code != '' AND pd.code != '0' AND pd.price > 0
     GROUP BY pd.code`);

  if (!soldProducts.length) { log("No products found."); return; }

  // Full stock ledger — SUM(qty) over all movements
  const stockRows = await query(conn,
    `SELECT CODE AS sku, COALESCE(SUM(qty), 0) AS stockQty FROM stran GROUP BY CODE`);

  const stockMap = Object.create(null);
  for (const s of stockRows) stockMap[s.sku] = Number(s.stockQty);

  const products = soldProducts.map(p => ({
    sku:      p.sku,
    name:     p.name,
    price:    Number(p.price),
    category: p.category || "Uncategorised",
    stockQty: Math.max(0, Math.round(stockMap[p.sku] ?? 0)),
  }));

  // Smaller batches (200) with a 2-minute timeout each — avoids ECONNRESET
  // on slow shop internet when uploading thousands of products.
  const BATCH = 200;
  let synced = 0;
  for (let i = 0; i < products.length; i += BATCH) {
    const batchNum = Math.floor(i / BATCH) + 1;
    const r = await apiPostLarge("/sync/products", { products: products.slice(i, i + BATCH) }, SECRET);
    if (r.status === 200) {
      synced += Math.min(BATCH, products.length - i);
      log(`  Batch ${batchNum} OK (${synced}/${products.length})`);
    } else {
      log(`  Batch ${batchNum} failed [${r.status}]: ${r.body.slice(0, 120)}`);
    }
  }
  log(`Products synced: ${synced} of ${products.length}`);
}

// ── 3. Apply pending changes from cloud ──────────────────────
async function applyPendingChanges(conn, token) {
  const r = await apiGet("/sync/pending-changes", token);
  if (r.status !== 200) return;
  let changes;
  try { changes = JSON.parse(r.body); } catch { return; }
  if (!changes.length) return;

  log(`Applying ${changes.length} pending change(s)…`);
  for (const change of changes) {
    try {
      if (change.type === "stock_adjustment") {
        const { sku, delta, name, reason } = change.payload;
        await query(conn,
          `INSERT INTO stran (CODE, descr, stdate, qty, tt, trandesc, staff, source)
           VALUES (?, ?, CURDATE(), ?, 'ADJ', ?, 'WEB', 'WEB')`,
          [sku, name || sku, Number(delta), reason || "Web stock adjustment"]);
      }
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
  const [maxRct] = await query(conn, "SELECT MAX(CAST(receiptno AS UNSIGNED)) AS maxno FROM pos_header");
  let nextNo = (Number(maxRct.maxno) || 0) + 1;

  for (const sale of sales) {
    const rctNo = String(nextNo++).padStart(8, "0");
    const pd    = sale.paymentDetails || {};
    const now   = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const hasCash  = Number(pd.cash  || 0) > 0;
    const hasMpesa = Number(pd.mpesa || 0) > 0;
    const hasOther = Number(pd.coop || pd.equity_justann || pd.equity_mwalimu || pd.kcb || 0) > 0;
    const tyype    = hasCash && !hasMpesa && !hasOther ? "Cash Sale"
                   : !hasCash && hasMpesa && !hasOther ? "Mobile Money" : "Multiple";

    try {
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_header
           (receiptno,amount,paid,changee,tax,staff,arcode,arname,tyype,
            trandate,posdate,cash,mpesa,creditcard,cheque,posted,is_return,disc)
         VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,1,0,0)`,
        [rctNo, sale.total, sale.amountPaid, sale.changeDue,
         sale.staffCode || "WEB", "", "", tyype, now.slice(0, 10), now,
         Number(pd.cash || 0), Number(pd.mpesa || 0), 0, 0],
        (e) => e ? rej(e) : res()
      ));

      const ppdPayname = hasMpesa ? "MPESA" : hasOther ? "BANK" : "CASH";
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_payment_details (receiptno, payname, pamount) VALUES (?, ?, ?)`,
        [rctNo, ppdPayname, sale.total],
        (e) => e ? rej(e) : res()
      )).catch(() => {});

      for (const item of sale.items) {
        await new Promise((res, rej) => conn.query(
          `INSERT INTO pos_details (receiptno,code,description,qty,price,total,vat,posted,disc)
           VALUES (?,?,?,?,?,?,0,1,0)`,
          [rctNo, item.sku, item.productName, item.qty, item.unitPrice, item.unitPrice * item.qty],
          (e) => e ? rej(e) : res()
        ));
        await new Promise((res, rej) => conn.query(
          `INSERT INTO stran (CODE,descr,stdate,qty,price,total,tt,trandesc,staff,source)
           VALUES (?,?,?,?,?,?,'SALES','SALES',?,'WEB')`,
          [item.sku, item.productName, now.slice(0, 10), -item.qty,
           item.unitPrice, item.unitPrice * item.qty, sale.staffCode || "WEB"],
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
  log(`=== Mwalimu Sync Agent v${AGENT_VERSION} starting ===`);

  // Check for update before doing anything else
  await checkForUpdate();

  const today = kenyanDate();
  const conn  = mysql.createConnection(MYSQL);
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));
  log("Connected to MySQL on server-pc.");

  const [countRow] = await query(conn,
    `SELECT COUNT(*) AS cnt FROM pos_header WHERE DATE(trandate) = ? AND posted = 1`, [today]);
  const currentCount = Number(countRow.cnt);
  const cp           = loadCheckpoint();
  const hasNewData   = currentCount !== cp.txCount || cp.date !== today;

  let token;
  try { token = await getSyncToken(); } catch (e) { log("Auth failed: " + e.message); }

  if (hasNewData) {
    await pushMetrics(conn, today).catch(e => log("Metrics error: " + e.message));
  } else {
    log(`No new transactions (${currentCount} posted today). Metrics skipped.`);
  }

  // Products + stock: at most once per hour (heavy stran aggregate)
  const nowMs          = Date.now();
  const productSyncDue = cp.date !== today || nowMs - (cp.lastProductSync || 0) > 60 * 60 * 1000;
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
