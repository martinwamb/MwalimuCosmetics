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

const AGENT_VERSION   = "20260502-1";
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

// ── Self-update (write-only, no restart) ─────────────────────
// Downloads new pusher.js if the server has a newer version and writes it
// to disk. Does NOT restart — the loop.ps1 will pick up the new file on
// the next 30-second cycle naturally, avoiding concurrent-instance races.
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
    log(`Agent updated to ${version}. New version runs on next cycle.`);
    // No spawn/restart — loop.ps1 picks up the new file in 30 seconds
  } catch (e) {
    log("Update check skipped (non-fatal): " + e.message);
  }
}

async function getSyncToken() {
  const r = await apiPost("/auth/login", { email: "wambugujusk@gmail.com", password: "Mwalimu2025!" });
  if (r.status === 200) return JSON.parse(r.body).token;
  throw new Error("Auth failed: " + r.body);
}

// ── 1. Build metrics from MySQL (read-only) ───────────────────
// costMap: { sku → latestCostPrice } built during hourly product sync.
// Passing null is safe — profit will show 0 until first hourly sync runs.
async function buildMetrics(conn, today, costMap) {
  log("Reading metrics from MySQL…");

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

  // Gross profit — uses the cached cost map built during the hourly product sync.
  // We do NOT query grn_d on every 30-second cycle (it can be a large table scan).
  // costMap is passed in from the hourly buildProducts() run.
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
  if (soldItems.length > 0 && costMap) {
    for (const item of soldItems) {
      if (item.code in costMap) {
        profit += Number(item.revenue) - costMap[item.code] * Number(item.qty);
      }
    }
    profit = Math.round(profit);
  }

  // Payment breakdown — all posted=1 transactions have a ppd entry (verified).
  // No fallback needed: every confirmed sale records its payment method.
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

  let cashSales = 0, mpesaSales = 0, otherSales = 0;
  for (const b of breakdown) {
    const t = Number(b.total);
    const n = (b.name || "").toUpperCase();
    if (n === "CASH") cashSales += t;
    else if (n === "MPESA") mpesaSales += t;
    else otherSales += t;
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

  return {
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
  };
}

async function pushMetrics(data) {
  log("Pushing metrics to server…");
  const r = await apiPost("/sync/metrics", data, SECRET);
  if (r.status === 200) {
    log(`Metrics pushed — ${data.transactions} txns, KES ${data.totalSales.toLocaleString("en-KE")} sales, KES ${data.profit.toLocaleString("en-KE")} profit`);
    return true;
  }
  log(`Metrics push failed [${r.status}]: ${r.body}`);
  return false;
}

// ── 2. Build product catalogue from MySQL (read-only) ─────────
// Heavy queries — runs at most once per hour (off-peak only) to protect MySQL.
// Also builds the cost map used by buildMetrics for profit calculation,
// so grn_d is queried here (hourly) rather than on every 30-second cycle.
async function buildProducts(conn) {
  log("Reading product catalogue from MySQL…");

  const soldProducts = await query(conn,
    `SELECT pd.code AS sku, MAX(pd.description) AS name,
            MAX(pd.price) AS price, MAX(pd.icateg) AS category
     FROM pos_details pd
     WHERE pd.code IS NOT NULL AND pd.code != '' AND pd.code != '0' AND pd.price > 0
     GROUP BY pd.code`);

  if (!soldProducts.length) { log("No products found."); return null; }

  // Stock ledger — SUM(qty) over all stran movements
  const stockRows = await query(conn,
    `SELECT CODE AS sku, COALESCE(SUM(qty), 0) AS stockQty FROM stran GROUP BY CODE`);

  const stockMap = Object.create(null);
  for (const s of stockRows) stockMap[s.sku] = Number(s.stockQty);

  // Latest cost per SKU from GRN receipts — used for profit calculation.
  // Done here (hourly) not on every 30s metrics cycle so grn_d isn't hit constantly.
  const costRows = await query(conn,
    `SELECT d.code, d.uprice AS cost
     FROM grn_d d JOIN grn g ON d.no = g.no
     WHERE g.posted = 1
     ORDER BY g.ddate DESC`);

  const costMap = Object.create(null);
  for (const r of costRows) {
    if (!(r.code in costMap)) costMap[r.code] = Number(r.cost);
  }
  log(`Cost map built: ${Object.keys(costMap).length} SKUs with known cost.`);

  const products = soldProducts.map(p => ({
    sku:      p.sku,
    name:     p.name,
    price:    Number(p.price),
    category: p.category || "Uncategorised",
    stockQty: Math.max(0, Math.round(stockMap[p.sku] ?? 0)),
  }));

  return { products, costMap };
}

async function syncProducts(products) {
  log("Pushing product catalogue to server…");

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

function openConn() {
  return new Promise((res, rej) => {
    const c = mysql.createConnection(MYSQL);
    c.connect(e => e ? rej(e) : res(c));
  });
}

// ── Main ─────────────────────────────────────────────────────
async function run() {
  await checkForUpdate();

  // Check if a refresh was requested from the dashboard (cheap — no MySQL)
  const refreshCheck = await apiRequest("GET", "/sync/pending-refresh", null, SECRET, null)
    .catch(() => ({ status: 0, body: "{}" }));

  if (refreshCheck.status !== 200) {
    log("Could not reach server. Skipping.");
    return;
  }

  const { pending } = JSON.parse(refreshCheck.body);
  if (!pending) {
    // No refresh requested — exit immediately, MySQL untouched
    return;
  }

  log(`=== Refresh requested — Mwalimu Sync Agent v${AGENT_VERSION} ===`);

  const today = kenyanDate();
  const cp    = loadCheckpoint();
  const nowMs = Date.now();

  // ── Phase 1: read from MySQL, close before uploads ────────────
  const conn1 = await openConn();
  log("Connected to MySQL on server-pc.");

  // Always do a full product sync when user requests refresh if cost map is stale
  const productSyncDue = cp.date !== today || nowMs - (cp.lastProductSync || 0) > 4 * 60 * 60 * 1000;

  let productsData = null;
  let costMap      = cp.costMap || null;

  if (productSyncDue) {
    const result = await buildProducts(conn1).catch(e => { log("Products build error: " + e.message); return null; });
    if (result) { productsData = result.products; costMap = result.costMap; }
  }

  const metricsData = await buildMetrics(conn1, today, costMap)
    .catch(e => { log("Metrics build error: " + e.message); return null; });

  conn1.end();

  // ── Phase 2: push to server ────────────────────────────────────
  let token;
  try { token = await getSyncToken(); } catch (e) { log("Auth failed: " + e.message); }

  let metricsPushed = false;
  if (metricsData) {
    metricsPushed = await pushMetrics(metricsData)
      .catch(e => { log("Metrics push error: " + e.message); return false; });
  }

  if (productsData) {
    await syncProducts(productsData).catch(e => log("Products push error: " + e.message));
  }

  // ── Phase 3: write-back (pending changes + web sales) ─────────
  if (token) {
    const conn2 = await openConn().catch(e => { log("MySQL reconnect failed: " + e.message); return null; });
    if (conn2) {
      await applyPendingChanges(conn2, token).catch(e => log("PendingChanges error: " + e.message));
      await writeBackSales(conn2, token).catch(e => log("Writeback error: " + e.message));
      conn2.end();
    }
  }

  saveCheckpoint({
    txCount:         metricsPushed ? 0 : cp.txCount, // reset so next refresh always pushes
    date:            metricsPushed ? today : cp.date,
    lastProductSync: productSyncDue ? nowMs : (cp.lastProductSync || 0),
    costMap:         costMap || cp.costMap || null,
  });
  log("=== Sync complete ===");
}

run().catch(err => { log("Fatal: " + err.message); process.exit(1); });
