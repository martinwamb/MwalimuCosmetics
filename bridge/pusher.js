/**
 * Mwalimu Cosmetics — Bridge Sync Agent
 * Runs every 10 minutes on any PC with ethernet (MySQL) + internet (Hetzner).
 *
 * 1. Pushes today's sales metrics dashboard
 * 2. Syncs product catalogue + stock levels to web
 * 3. Writes back any web-created sales to MySQL
 */

const mysql = require("mysql");
const https = require("https");

const MYSQL  = { host:"10.10.10.4", port:3306, user:"root", password:"allowme", database:"mwalimuinvest", ssl:false, insecureAuth:true, connectTimeout:8000 };
const API    = "https://api.mwalimucosmetics.com";
const SECRET = "mwalimu-sync-secret";
const TODAY  = new Date().toISOString().slice(0, 10);

function log(msg) { console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${msg}`); }

function query(conn, sql) {
  return new Promise((res, rej) => conn.query(sql, (e, r) => e ? rej(e) : res(r)));
}

function apiPost(path, body, secret) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: "api.mwalimucosmetics.com",
      path, method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...(secret ? { "x-sync-secret": secret } : {}),
      },
    }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res({ status: r.statusCode, body: b })); });
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
    }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res({ status: r.statusCode, body: b })); });
    req.on("error", rej);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

// ── Get sync token ───────────────────────────────────────────
async function getSyncToken() {
  const r = await apiPost("/auth/login", { email: "wambugujusk@gmail.com", password: "Mwalimu2025!" });
  if (r.status === 200) return JSON.parse(r.body).token;
  throw new Error("Could not get sync token: " + r.body);
}

// ── 1. Push today's metrics ──────────────────────────────────
async function pushMetrics(conn) {
  log("Syncing metrics…");
  const [summary] = await query(conn,
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(amount),0) AS totalSales,
            COALESCE(SUM(cash),0) AS cashSales, COALESCE(SUM(mpesa),0) AS mpesaSales,
            COALESCE(SUM(creditcard)+SUM(cheque),0) AS otherSales
     FROM pos_header WHERE DATE(trandate)='${TODAY}' AND (is_return=0 OR is_return IS NULL)`);

  const breakdown = await query(conn,
    `SELECT ppd.payname AS name, COUNT(DISTINCT ppd.receiptno) AS transactions, COALESCE(SUM(ppd.pamount),0) AS total
     FROM pos_payment_details ppd JOIN pos_header ph ON ppd.receiptno=ph.receiptno
     WHERE DATE(ph.trandate)='${TODAY}' AND (ph.is_return=0 OR ph.is_return IS NULL)
     GROUP BY ppd.paynumber, ppd.payname ORDER BY total DESC`);

  const topProducts = await query(conn,
    `SELECT d.code, d.description AS name, SUM(d.qty) AS qtySold, SUM(d.total) AS revenue
     FROM pos_details d JOIN pos_header h ON d.receiptno=h.receiptno
     WHERE DATE(h.trandate)='${TODAY}' AND (h.is_return=0 OR h.is_return IS NULL)
     GROUP BY d.code, d.description ORDER BY revenue DESC LIMIT 10`);

  const byStaff = await query(conn,
    `SELECT staff, COUNT(*) AS transactions, COALESCE(SUM(amount),0) AS total
     FROM pos_header WHERE DATE(trandate)='${TODAY}' AND (is_return=0 OR is_return IS NULL)
     GROUP BY staff ORDER BY total DESC`);

  const r = await apiPost("/sync/metrics", {
    forDate: TODAY,
    transactions:     Number(summary.transactions),
    totalSales:       Number(summary.totalSales),
    cashSales:        Number(summary.cashSales),
    mpesaSales:       Number(summary.mpesaSales),
    otherSales:       Number(summary.otherSales),
    paymentBreakdown: breakdown.map(r => ({ name: r.name, transactions: Number(r.transactions), total: Number(r.total) })),
    topProducts:      topProducts.map(r => ({ code: r.code, name: r.name, qtySold: Number(r.qtySold), revenue: Number(r.revenue) })),
    byStaff:          byStaff.map(r => ({ staff: r.staff, transactions: Number(r.transactions), total: Number(r.total) })),
  }, SECRET);

  log(r.status === 200 ? `Metrics pushed (${summary.transactions} txns, KES ${summary.totalSales})` : `Metrics push failed: ${r.body}`);
}

// ── 2. Sync product catalogue ────────────────────────────────
async function syncProducts(conn) {
  log("Syncing product catalogue…");

  const products = await query(conn,
    `SELECT
       pd.code AS sku,
       MAX(pd.description) AS name,
       MAX(pd.price) AS price,
       MAX(pd.icateg) AS category,
       COALESCE((
         SELECT SUM(CASE WHEN s.transign='P' THEN s.qty WHEN s.transign='N' THEN -s.qty ELSE 0 END)
         FROM stran s WHERE s.CODE = pd.code
       ), 0) AS stockQty
     FROM pos_details pd
     WHERE pd.code IS NOT NULL AND pd.code != '' AND pd.code != '0' AND pd.price > 0
     GROUP BY pd.code
     ORDER BY name
     LIMIT 5000`);

  if (!products.length) { log("No products found."); return; }

  const r = await apiPost("/sync/products", { products: products.map(p => ({
    sku:      p.sku,
    name:     p.name,
    price:    Number(p.price),
    category: p.category || "Uncategorised",
    stockQty: Number(p.stockQty),
  })) }, SECRET);

  log(r.status === 200 ? `Products synced: ${products.length}` : `Product sync failed: ${r.body}`);
}

// ── 3. Write back web sales to MySQL ────────────────────────
async function writeBackSales(conn, token) {
  log("Checking for web sales to write back…");

  const r = await apiGet("/pos/unsynced", token);
  if (r.status !== 200) { log("Could not fetch unsynced sales: " + r.body); return; }

  const sales = JSON.parse(r.body);
  if (!sales.length) { log("No unsynced web sales."); return; }

  log(`Writing ${sales.length} web sale(s) to MySQL…`);

  // Get next available receipt number
  const [maxRct] = await query(conn, "SELECT MAX(CAST(receiptno AS UNSIGNED)) as maxno FROM pos_header");
  let nextNo = (Number(maxRct.maxno) || 0) + 1;

  for (const sale of sales) {
    const rctNo = String(nextNo++).padStart(8, "0");
    const now   = new Date().toISOString().slice(0, 19).replace("T", " ");
    const pd    = sale.paymentDetails || {};

    try {
      await query(conn,
        `INSERT INTO pos_header (receiptno,amount,paid,changee,tax,staff,pos,arcode,arname,tyype,
           trandate,posdate,cash,mpesa,creditcard,cheque,posted,is_return,disc)
         VALUES (?,?,?,?,0,?,1,'','','CASH',?,?,?,?,?,?,1,0,0)`,
        // Using direct query format for mysql package
      );

      // Use positional params differently for mysql package
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_header (receiptno,amount,paid,changee,tax,staff,arcode,arname,tyype,trandate,posdate,cash,mpesa,creditcard,cheque,posted,is_return,disc)
         VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,1,0,0)`,
        [rctNo, sale.total, sale.amountPaid, sale.changeDue, sale.staffCode || "WEB",
         "", "", "CASH", now.slice(0,10), now, pd.cash||0, pd.mpesa||0, 0, 0],
        (e) => e ? rej(e) : res()
      ));

      for (const item of sale.items) {
        await new Promise((res, rej) => conn.query(
          `INSERT INTO pos_details (receiptno,code,description,qty,price,total,vat,posted,disc)
           VALUES (?,?,?,?,?,?,0,1,0)`,
          [rctNo, item.sku, item.productName, item.qty, item.unitPrice, item.unitPrice * item.qty],
          (e) => e ? rej(e) : res()
        ));

        // Stock movement
        await new Promise((res, rej) => conn.query(
          `INSERT INTO stran (CODE,descr,stdate,qty,pu,price,total,tqty,tt,staff,transign)
           VALUES (?,?,?,?,0,?,?,?,\'SALES\',?,'N')`,
          [item.sku, item.productName, now.slice(0,10), item.qty, item.unitPrice, item.unitPrice*item.qty, 0, sale.staffCode||"WEB"],
          (e) => e ? rej(e) : res()
        ));
      }

      // Mark as synced on Hetzner
      await apiPost(`/pos/mark-synced`, { orderId: sale.id, mysqlReceiptNo: rctNo }, SECRET);
      log(`  Written: receipt ${rctNo}, KES ${sale.total}`);
    } catch (e) {
      log(`  Failed to write sale ${sale.id}: ${e.message}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────
async function run() {
  log("=== Mwalimu Sync Agent starting ===");

  const conn = mysql.createConnection(MYSQL);
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));
  log("Connected to MySQL on server-pc.");

  let token;
  try { token = await getSyncToken(); } catch(e) { log("Auth failed: " + e.message); }

  await pushMetrics(conn).catch(e => log("Metrics error: " + e.message));
  await syncProducts(conn).catch(e => log("Products error: " + e.message));
  if (token) await writeBackSales(conn, token).catch(e => log("Writeback error: " + e.message));

  conn.end();
  log("=== Sync complete ===");
}

run().catch(err => { log("Fatal: " + err.message); process.exit(1); });
