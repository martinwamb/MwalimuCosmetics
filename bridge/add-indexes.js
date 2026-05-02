/**
 * Mwalimu Cosmetics — One-time MySQL index additions
 * Run once from a PC on the LAN: node bridge/add-indexes.js
 *
 * Adds indexes that make the sync agent's queries faster and reduce
 * pressure on the MySQL server (POS slowdown prevention).
 */

const mysql = require("./node_modules/mysql");

const conn = mysql.createConnection({
  host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
  database: "mwalimuinvest", ssl: false, insecureAuth: true, connectTimeout: 10000,
});

function q(sql) {
  return new Promise((res, rej) => conn.query(sql, [], (e, r) => e ? rej(e) : res(r)));
}

async function addIndex(table, indexName, columns) {
  try {
    const existing = await q(`SHOW INDEX FROM ${table} WHERE Key_name = '${indexName}'`);
    if (existing.length > 0) {
      console.log(`[SKIP] ${table}.${indexName} already exists.`);
      return;
    }
    await q(`ALTER TABLE ${table} ADD INDEX ${indexName} (${columns})`);
    console.log(`[OK]   ${table}.${indexName} (${columns}) — created.`);
  } catch (e) {
    console.log(`[ERR]  ${table}.${indexName}: ${e.message}`);
  }
}

conn.connect(async err => {
  if (err) { console.error("Connect error:", err.message); process.exit(1); }
  console.log("Connected. Adding indexes…\n");

  // pos_payment_details — speeds up payment breakdown join
  await addIndex("pos_payment_details", "ppd_idx_receiptno", "receiptno");
  await addIndex("pos_payment_details", "ppd_idx_payname",   "payname");

  // grn_d — speeds up cost lookup (runs hourly now, but still benefits)
  await addIndex("grn_d", "grnd_idx_code", "code");
  await addIndex("grn_d", "grnd_idx_no",   "no");

  // grn — speeds up date-filtered purchase total query
  await addIndex("grn", "grn_idx_ddate", "ddate");

  // pos_header — already have idx_trandate, add posted for combined filter
  await addIndex("pos_header", "pos_idx_trandate_posted", "trandate, posted");

  console.log("\nDone. You can close this window.");
  conn.end(() => process.exit(0));
});
