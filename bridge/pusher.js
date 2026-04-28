/**
 * Mwalimu Cosmetics — Metrics Pusher
 * Runs on bridge PCs (ethernet + internet).
 * Reads today's metrics from MySQL on server-pc and pushes to Hetzner.
 */

const mysql  = require("mysql");
const https  = require("https");

const MYSQL = { host:"10.10.10.4", port:3306, user:"root", password:"allowme", database:"mwalimuinvest", ssl:false, insecureAuth:true, connectTimeout:8000 };
const API   = "https://api.mwalimucosmetics.com";
const SECRET = "mwalimu-sync-secret";

const TODAY = new Date().toISOString().slice(0, 10); // "2026-04-28"

function log(msg) {
  const t = new Date().toLocaleTimeString("en-KE");
  console.log(`[${t}] ${msg}`);
}

function query(conn, sql) {
  return new Promise((res, rej) => conn.query(sql, (e, r) => e ? rej(e) : res(r)));
}

function post(path, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: "api.mwalimucosmetics.com",
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-sync-secret": SECRET,
      },
    };
    const req = https.request(opts, r => {
      let buf = "";
      r.on("data", c => buf += c);
      r.on("end", () => res({ status: r.statusCode, body: buf }));
    });
    req.on("error", rej);
    req.setTimeout(15000, () => { req.destroy(new Error("Request timeout")); });
    req.write(data);
    req.end();
  });
}

async function run() {
  log("Connecting to MySQL on server-pc…");

  const conn = mysql.createConnection(MYSQL);
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));
  log("Connected to MySQL.");

  // Summary
  const [summary] = await query(conn,
    `SELECT COUNT(*) AS transactions,
            COALESCE(SUM(amount),0) AS totalSales,
            COALESCE(SUM(cash),0)   AS cashSales,
            COALESCE(SUM(mpesa),0)  AS mpesaSales,
            COALESCE(SUM(creditcard)+SUM(cheque),0) AS otherSales
     FROM pos_header
     WHERE DATE(trandate)='${TODAY}' AND (is_return=0 OR is_return IS NULL)`
  );

  // Per-payment-method breakdown
  const breakdown = await query(conn,
    `SELECT ppd.payname AS name,
            COUNT(DISTINCT ppd.receiptno) AS transactions,
            COALESCE(SUM(ppd.pamount),0)  AS total
     FROM pos_payment_details ppd
     JOIN pos_header ph ON ppd.receiptno = ph.receiptno
     WHERE DATE(ph.trandate)='${TODAY}' AND (ph.is_return=0 OR ph.is_return IS NULL)
     GROUP BY ppd.paynumber, ppd.payname
     ORDER BY total DESC`
  );

  // Top 10 products
  const topProducts = await query(conn,
    `SELECT d.code, d.description AS name,
            SUM(d.qty)   AS qtySold,
            SUM(d.total) AS revenue
     FROM pos_details d
     JOIN pos_header h ON d.receiptno = h.receiptno
     WHERE DATE(h.trandate)='${TODAY}' AND (h.is_return=0 OR h.is_return IS NULL)
     GROUP BY d.code, d.description
     ORDER BY revenue DESC
     LIMIT 10`
  );

  // Staff performance
  const byStaff = await query(conn,
    `SELECT staff, COUNT(*) AS transactions, COALESCE(SUM(amount),0) AS total
     FROM pos_header
     WHERE DATE(trandate)='${TODAY}' AND (is_return=0 OR is_return IS NULL)
     GROUP BY staff
     ORDER BY total DESC`
  );

  conn.end();
  log(`Read: ${summary.transactions} transactions, KES ${summary.totalSales}`);

  const payload = {
    forDate:          TODAY,
    transactions:     Number(summary.transactions),
    totalSales:       Number(summary.totalSales),
    cashSales:        Number(summary.cashSales),
    mpesaSales:       Number(summary.mpesaSales),
    otherSales:       Number(summary.otherSales),
    paymentBreakdown: breakdown.map(r => ({ name: r.name, transactions: Number(r.transactions), total: Number(r.total) })),
    topProducts:      topProducts.map(r => ({ code: r.code, name: r.name, qtySold: Number(r.qtySold), revenue: Number(r.revenue) })),
    byStaff:          byStaff.map(r => ({ staff: r.staff, transactions: Number(r.transactions), total: Number(r.total) })),
  };

  log("Pushing to Hetzner…");
  const result = await post("/sync/metrics", payload);
  if (result.status === 200) {
    log("Done — metrics pushed successfully.");
  } else {
    log(`Push failed: HTTP ${result.status} — ${result.body}`);
    process.exit(1);
  }
}

run().catch(err => {
  log("Error: " + err.message);
  process.exit(1);
});
