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
const today = new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10);

function q(sql,params){ return new Promise((res,rej)=>conn.query(sql,params||[],(e,r)=>e?rej(e):res(r))); }

conn.connect(async err=>{
  if(err){console.log("connect error:",err.message);process.exit(1);}

  console.log("\n=== grn_d columns ===");
  const grnCols = await q("DESCRIBE grn_d");
  console.log(grnCols.map(c=>c.Field+"("+c.Type+")").join(", "));

  console.log("\n=== grn columns ===");
  const grnH = await q("DESCRIBE grn");
  console.log(grnH.map(c=>c.Field+"("+c.Type+")").join(", "));

  // grn: key=no, date=ddate, total=gtotal
  // grn_d: key=no, cost=uprice
  console.log("\n=== GRN today ===");
  const grnToday = await q("SELECT g.no, g.ddate, ROUND(g.gtotal,0) AS purchased, COUNT(d.gdid) AS lineCount FROM grn g LEFT JOIN grn_d d ON g.no=d.no WHERE DATE(g.ddate)=? AND g.posted=1 GROUP BY g.no,g.ddate,g.gtotal",[today]);
  console.log(JSON.stringify(grnToday));

  console.log("\n=== GRN last 7 days total ===");
  const grn7 = await q("SELECT DATE(g.ddate) AS day, ROUND(SUM(g.gtotal),0) AS purchased FROM grn g WHERE g.ddate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND g.posted=1 GROUP BY DATE(g.ddate) ORDER BY day DESC");
  console.log(JSON.stringify(grn7));

  console.log("\n=== Sample grn_d cost data (uprice = cost) ===");
  const costs = await q("SELECT d.code, d.descr, d.qty, d.uprice AS costPrice, d.total FROM grn_d d JOIN grn g ON d.no=g.no WHERE g.ddate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND g.posted=1 ORDER BY g.ddate DESC LIMIT 8");
  console.log(JSON.stringify(costs));

  console.log("\n=== Profit sample: today posted sales vs latest cost ===");
  const profit = await q(`
    SELECT pd.code, MAX(pd.price) AS sellPrice,
      (SELECT d.uprice FROM grn_d d JOIN grn g ON d.no=g.no
       WHERE d.code=pd.code AND g.posted=1 ORDER BY g.ddate DESC LIMIT 1) AS latestCost,
      SUM(pd.qty) AS qtySold, ROUND(SUM(pd.total),0) AS revenue
    FROM pos_details pd
    JOIN pos_header ph ON pd.receiptno=ph.receiptno
    WHERE DATE(ph.trandate)=? AND ph.posted=1
      AND (ph.is_return=0 OR ph.is_return IS NULL)
    GROUP BY pd.code
    ORDER BY revenue DESC
    LIMIT 10`,[today]);
  console.log(JSON.stringify(profit));

  console.log("\n=== stran indexes ===");
  const si = await q("SHOW INDEX FROM stran");
  console.log(si.map(i=>i.Key_name+"("+i.Column_name+")").join(", "));

  console.log("\n=== pos_header indexes ===");
  const phi = await q("SHOW INDEX FROM pos_header");
  console.log(phi.map(i=>i.Key_name+"("+i.Column_name+")").join(", "));

  console.log("\n=== pos_details indexes ===");
  const pdi = await q("SHOW INDEX FROM pos_details");
  console.log(pdi.map(i=>i.Key_name+"("+i.Column_name+")").join(", "));

  conn.end(()=>process.exit(0));
});
