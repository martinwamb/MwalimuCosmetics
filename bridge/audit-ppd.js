const mysql = require("mysql");

// Credentials come from db-config.js (env var or the machine config file)
// rather than being written here. The require is guarded because this script
// may be copied to a PC where that file has not been deployed yet.
let CONN;
try {
  const cfg = require("./db-config");
  CONN = cfg.toDriverOptions(cfg.getMysqlConfig({ connectTimeout: 8000 }));
} catch {
  CONN = {
    host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
    database: "mwalimuinvest", insecureAuth: true, connectTimeout: 8000,
  };
}
const conn = mysql.createConnection(CONN);
const today = new Date(Date.now() + 3*60*60*1000).toISOString().slice(0,10);
function q(sql, params){ return new Promise((res,rej) => conn.query(sql, params||[], (e,r) => e?rej(e):res(r))); }

conn.connect(async err => {
  if(err){ console.log("err:", err.message); process.exit(1); }

  // Q1: Are there any posted=1 transactions missing from ppd?
  const missing = await q(
    `SELECT ph.posted, COUNT(*) AS cnt, ROUND(SUM(ph.amount),0) AS total
     FROM pos_header ph
     LEFT JOIN pos_payment_details ppd ON ph.receiptno = ppd.receiptno
     WHERE DATE(ph.trandate) = ? AND (ph.is_return=0 OR ph.is_return IS NULL)
       AND ppd.receiptno IS NULL
     GROUP BY ph.posted ORDER BY ph.posted`, [today]);
  console.log("Missing from ppd, by posted status:", JSON.stringify(missing));

  // Q2: posted=1 header total
  const [h] = await q(
    `SELECT COUNT(*) AS cnt, ROUND(SUM(amount),0) AS total
     FROM pos_header WHERE DATE(trandate)=? AND posted=1 AND (is_return=0 OR is_return IS NULL)`, [today]);
  console.log("pos_header posted=1:", JSON.stringify(h));

  // Q3: ppd total for posted=1 transactions only
  const [p] = await q(
    `SELECT COUNT(DISTINCT ppd.receiptno) AS cnt, ROUND(SUM(ppd.pamount),0) AS total
     FROM pos_payment_details ppd
     JOIN pos_header ph ON ppd.receiptno = ph.receiptno
     WHERE DATE(ph.trandate)=? AND ph.posted=1 AND (ph.is_return=0 OR ph.is_return IS NULL)`, [today]);
  console.log("ppd total (posted=1 only):", JSON.stringify(p));

  console.log("\nConclusion:");
  console.log("  posted=1 header total:  KES", h.total);
  console.log("  ppd total (posted=1):   KES", p.total);
  console.log("  Gap:                    KES", h.total - p.total);
  console.log("  Gap should be 0 if user is right (all untracked = drafts)");

  conn.end(() => process.exit(0));
});
