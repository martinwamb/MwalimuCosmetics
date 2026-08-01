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

const AGENT_VERSION   = "20260801-37";

// Credentials resolve from db-config.js (env var or C:\MwalimuSync\db-config.json)
// so they are not carried in source. The require is guarded because this file
// self-updates on its own: a new pusher.js can land on a PC before
// db-config.js has been deployed there, and the agent must keep running
// rather than die with MODULE_NOT_FOUND. The fallback is the behaviour this
// script had previously, so an un-provisioned PC is no worse off than before.
let MYSQL, MYSQL_SOURCE;
try {
  const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");
  const cfg = getMysqlConfig();
  MYSQL = toDriverOptions(cfg);
  MYSQL_SOURCE = describeConfigSource(cfg);
} catch {
  MYSQL = {
    host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
    database: "mwalimuinvest", ssl: false, insecureAuth: true, connectTimeout: 8000,
  };
  MYSQL_SOURCE = "MySQL credentials: inline fallback (db-config.js not deployed on this PC)";
}
const API             = "https://api.mwalimucosmetics.com";
const SECRET          = "mwalimu-sync-secret";
const CHECKPOINT_FILE = "C:\\MwalimuSync\\checkpoint.json";
const SELF_PATH       = "C:\\MwalimuSync\\pusher.js";

function kenyanDate() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function getDatesRange(start, end) {
  const dates = [];
  let cur = start;
  while (cur <= end) { dates.push(cur); cur = addDays(cur, 1); }
  return dates;
}
function cleanRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (v instanceof Date)        out[k] = v.toISOString();
    else if (Buffer.isBuffer(v))       out[k] = v.toString("base64");
    else                               out[k] = v;
  }
  return out;
}
const _logLines = [];
function log(msg) {
  const line = `[${new Date().toLocaleTimeString("en-KE")}] ${msg}`;
  console.log(line);
  _logLines.push(line);
  if (_logLines.length > 60) _logLines.shift();
}

function query(conn, sql, params, timeoutMs) {
  const spec = timeoutMs ? { sql, timeout: timeoutMs } : sql;
  return new Promise((res, rej) =>
    conn.query(spec, params || [], (e, r) => e ? rej(e) : res(r))
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

// ── FumasV5 POS auto-update ───────────────────────────────────
// Auto-detect FumasV5 installation folder — different PCs may have it
// in different locations (C:\futuresoft\Debugv5, C:\mwalimu\Debugv5, etc.)
const FUMAS_CANDIDATES = [
  "C:\\futuresoft\\Debugv5",
  "C:\\mwalimu\\Debugv5",
  "C:\\fumasv5\\Debugv5",
  "C:\\FumasV5",
];
const FUMAS_DIR = FUMAS_CANDIDATES.find(p => {
  try { return fs.existsSync(p + "\\FumasV5.exe"); } catch { return false; }
}) || "C:\\mwalimu\\Debugv5";
const FUMAS_EXE      = FUMAS_DIR + "\\FumasV5.exe";
const FUMAS_NEW      = FUMAS_DIR + "\\FumasV5_new.exe";
const FUMAS_VER_FILE = FUMAS_DIR + "\\FumasV5-version.txt";

async function checkFumasUpdate() {
  const cp = loadCheckpoint();
  // Skip if checked successfully in last 24h. If last check failed (no local version
  // file exists and check was recent), retry after 1 hour instead of 24.
  const lastCheck = cp.lastFumasCheck || 0;
  const hasLocal  = fs.existsSync(FUMAS_VER_FILE);
  const retryMs   = hasLocal ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000; // 1h if not yet downloaded
  if (Date.now() - lastCheck < retryMs) return;
  try {
    // FumasV5 updates are handled via fumas_update pending change (more reliable)
    return; // skip startup FumasV5 check — avoids timeout issues on slow connections
    if (r.status !== 200) return;
    const serverVersion = JSON.parse(r.body).version;
    const localVersion  = hasLocal ? fs.readFileSync(FUMAS_VER_FILE, "utf8").trim() : "";
    // Only save checkpoint after a successful version response (not on timeout/error)
    saveCheckpoint({ ...cp, lastFumasCheck: Date.now() });
    if (serverVersion === localVersion) return; // already up to date

    log(`New FumasV5 version available (${serverVersion}). Downloading…`);
    // Download with a long timeout — the exe is large (~33MB)
    const dl = await apiRequest("GET", "/sync/agent/FumasV5.exe", null, null, null, 300000);
    if (dl.status !== 200) { log("FumasV5 download failed: " + dl.status); return; }

    fs.writeFileSync(FUMAS_NEW, dl.body, "binary");
    fs.writeFileSync(FUMAS_VER_FILE, serverVersion, "utf8");
    log(`FumasV5 ${serverVersion} staged as FumasV5_new.exe — will apply on next POS start.`);
  } catch (e) {
    log("FumasV5 update check skipped: " + e.message);
  }
}

// ── Self-update (write-only, no restart) ─────────────────────
// Downloads new pusher.js if the server has a newer version and writes it
// to disk. Does NOT restart — the loop.ps1 will pick up the new file on
// the next 30-second cycle naturally, avoiding concurrent-instance races.
// Only runs once per minute (not every 5s) to avoid wasting bandwidth on
// flaky connections.
async function checkForUpdate() {
  const cp = loadCheckpoint();
  if (Date.now() - (cp.lastUpdateCheck || 0) < 60000) return; // once per minute
  try {
    saveCheckpoint({ ...cp, lastUpdateCheck: Date.now() });
    // Use POST — GET requests timeout on some networks but POST works reliably
    const r = await apiRequest("POST", "/sync/agent-version", {}, null, null, 15000);
    if (r.status !== 200) return;
    const { version } = JSON.parse(r.body);
    if (version === AGENT_VERSION) return;

    log(`New agent version available (${version}). Downloading…`);
    const dl = await apiRequest("POST", "/sync/agent/get-file", { filename: "pusher.js" }, null, null, 60000);
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
// Profit is computed directly from pos_details.buy_cost below — no
// costMap dependency (removed since commit 8aac26a switched profit to
// buy_cost; buildProducts()/checkpoint.costMap still feeds Product.cost
// in the catalog sync, a separate concern from this daily profit metric).
async function buildMetrics(conn, today) {
  log("Reading metrics from MySQL…");

  // Use range conditions (>= and <) instead of DATE(col) = ? so MySQL can use
  // the index on trandate/ddate without a full-table function scan.
  // This is the critical fix that prevents POS table locks during each refresh.
  const tomorrow = addDays(today, 1);
  const t0 = today    + " 00:00:00";
  const t1 = tomorrow + " 00:00:00";

  // Confirmed paid sales only (posted=1)
  const [paid] = await query(conn,
    `SELECT COUNT(*) AS transactions,
            COALESCE(SUM(amount), 0) AS totalSales,
            COALESCE(SUM(tax),    0) AS totalTax
     FROM pos_header
     WHERE trandate >= ? AND trandate < ? AND posted = 1 AND (is_return = 0 OR is_return IS NULL)`,
    [t0, t1]);

  // Unposted drafts (posted=0) — money not yet received
  const [draft] = await query(conn,
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(amount), 0) AS totalSales
     FROM pos_header
     WHERE trandate >= ? AND trandate < ? AND posted = 0 AND (is_return = 0 OR is_return IS NULL)`,
    [t0, t1]);

  // GRN purchases: stock received today at cost price
  const [grn] = await query(conn,
    `SELECT COALESCE(SUM(gtotal), 0) AS purchases
     FROM grn WHERE ddate >= ? AND ddate < ? AND posted = 1`,
    [t0, t1]);

  // Gross profit — pos_details.buy_cost is the total cost for the line (qty × unit_cost),
  // set by FumasV5 at the time of sale from the stock master. SUM(total - buy_cost) across
  // all posted lines gives the day's gross profit directly without needing a cost map join.
  const [cogsRow] = await query(conn,
    `SELECT ROUND(SUM(pd.total - COALESCE(pd.buy_cost, 0)), 0) AS gross_profit
     FROM pos_details pd
     JOIN pos_header ph ON pd.receiptno = ph.receiptno
     WHERE ph.trandate >= ? AND ph.trandate < ? AND ph.posted = 1
       AND (ph.is_return = 0 OR ph.is_return IS NULL)`,
    [t0, t1]);
  const profit = Math.round(Number(cogsRow?.gross_profit ?? 0));

  // Payment breakdown
  const breakdown = await query(conn,
    `SELECT ppd.payname AS name,
            COUNT(DISTINCT ppd.receiptno) AS transactions,
            COALESCE(SUM(ppd.pamount), 0) AS total
     FROM pos_payment_details ppd
     JOIN pos_header ph ON ppd.receiptno = ph.receiptno
     WHERE ph.trandate >= ? AND ph.trandate < ? AND ph.posted = 1
       AND (ph.is_return = 0 OR ph.is_return IS NULL)
     GROUP BY ppd.paynumber, ppd.payname
     ORDER BY total DESC`,
    [t0, t1]);

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
     WHERE h.trandate >= ? AND h.trandate < ? AND h.posted = 1
       AND (h.is_return = 0 OR h.is_return IS NULL)
       AND d.code IS NOT NULL AND d.code != ''
     GROUP BY d.code ORDER BY revenue DESC LIMIT 10`,
    [t0, t1]);

  // Staff: net sales and returns shown separately
  const byStaff = await query(conn,
    `SELECT staff,
       SUM(CASE WHEN posted = 1 AND (is_return = 0 OR is_return IS NULL) THEN 1     ELSE 0 END) AS transactions,
       COALESCE(SUM(CASE WHEN posted = 1 AND (is_return = 0 OR is_return IS NULL) THEN amount ELSE 0 END), 0) AS sales,
       COALESCE(SUM(CASE WHEN is_return = 1 THEN amount ELSE 0 END), 0) AS returns
     FROM pos_header WHERE trandate >= ? AND trandate < ?
     GROUP BY staff ORDER BY sales DESC`,
    [t0, t1]);

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
async function buildProducts(conn, cp) {
  log("Reading product catalogue from MySQL…");

  // SKUs are trimmed so they join correctly in PostgreSQL.
  // Use MAX(price) for performance — GROUP_CONCAT+JOIN pos_header was causing
  // POS lag by scanning millions of joined rows on every product sync.
  // Price accuracy is secondary to not freezing the POS cashier screen.
  const soldProducts = await query(conn,
    `SELECT pd.code AS sku, MAX(pd.description) AS name,
            MAX(pd.price) AS price, MAX(pd.icateg) AS category
     FROM pos_details pd
     WHERE pd.code IS NOT NULL AND pd.code != '' AND pd.code != '0' AND pd.price > 0
     GROUP BY pd.code`);

  if (!soldProducts.length) { log("No products found."); return null; }

  // Stock ledger strategy:
  // The full stran GROUP BY (SUM over all history) is slow on large tables —
  // even with an index it can take minutes and block the POS on every sync.
  //
  // Solution: cache the stock totals in checkpoint (stockMap). On each sync:
  //   - If we have a cached stockMap: apply ONLY today's movements as a delta.
  //   - If no cached stockMap (first ever run): do the full GROUP BY ONCE.
  //     That one-time run may be slow but the result is cached forever after.
  //
  // This means update-agent.bat clearing checkpoint.json only loses the cache —
  // next run does the full query once, then caches again. Subsequent syncs are fast.

  let stockMap = cp.stockMap ? Object.create(null) : null;
  if (cp.stockMap) {
    // Fast path: restore cached totals and apply today's delta only
    Object.assign(stockMap, cp.stockMap);
    const today = kenyanDate();
    const todayRows = await query(conn,
      `SELECT CODE AS sku, COALESCE(SUM(qty), 0) AS delta
       FROM stran WHERE stdate >= ? AND stdate < ?
       GROUP BY CODE`,
      [today + " 00:00:00", addDays(today, 1) + " 00:00:00"], 15000)
      .catch(() => []);
    for (const r of todayRows) {
      const sku = (r.sku || '').trim();
      stockMap[sku] = (stockMap[sku] || 0) + Number(r.delta);
    }
    log(`Stock: using cache + ${todayRows.length} today's movements.`);
  } else {
    // Slow path (first run or cache cleared): full historical scan, then cache
    log("Building stock totals from full stran history (first run — may take a moment)…");
    const stockRows = await query(conn,
      `SELECT CODE AS sku, COALESCE(SUM(qty), 0) AS stockQty FROM stran GROUP BY CODE`,
      [], 300000)  // 5-minute timeout for initial index build
      .catch(e => { log("stran full scan failed: " + e.message); return []; });
    stockMap = Object.create(null);
    for (const s of stockRows) stockMap[(s.sku || '').trim()] = Number(s.stockQty);
    log(`Stock totals built: ${Object.keys(stockMap).length} SKUs.`);
  }

  // Latest cost per SKU from GRN receipts — used for profit calculation.
  // Done here (hourly) not on every 30s metrics cycle so grn_d isn't hit constantly.
  // Limit to last 2 years of GRNs — older costs are irrelevant and a full
  // scan of grn_d with no date filter causes unnecessary MySQL load.
  const costRows = await query(conn,
    `SELECT d.code, d.uprice AS cost
     FROM grn_d d JOIN grn g ON d.no = g.no
     WHERE g.posted = 1 AND g.ddate >= DATE_SUB(NOW(), INTERVAL 2 YEAR)
     ORDER BY g.ddate DESC`);

  // Trim SKUs before building maps — POS data sometimes has trailing spaces
  // which cause JOIN failures in PostgreSQL analysis queries.
  const costMap = Object.create(null);
  for (const r of costRows) {
    const sku = (r.code || '').trim();
    if (sku && !(sku in costMap)) costMap[sku] = Number(r.cost);
  }
  log(`Cost map built: ${Object.keys(costMap).length} SKUs with known cost.`);

  // Wholesale and special prices from the stock master table (sitems).
  // First discover the actual column names for wholesale/special (varies by
  // FumasV5 version) by querying INFORMATION_SCHEMA, then fetch the prices.
  const priceMap = Object.create(null);
  try {
    // Step 1: find the table that holds price levels (varies by FumasV5 version)
    const candidateTables = ['sitems','stockitems','stock_items','items','pricelist','price_list','products','stock','sitem'];
    const foundTables = await query(conn,
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${candidateTables.map(() => '?').join(',')})`,
      candidateTables);

    if (!foundTables.length) {
      // Log all tables in the DB so we can identify the right one
      const allTables = await query(conn,
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`);
      log(`Price table not found. All tables: ${allTables.map(t => t.TABLE_NAME).join(', ')}`);
      throw new Error("price table not found");
    }

    const priceTableName = foundTables[0].TABLE_NAME;
    const cols = await query(conn,
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()
       ORDER BY ORDINAL_POSITION`, [priceTableName]);
    const colNames = cols.map(c => (c.COLUMN_NAME || '').toUpperCase());
    log(`${priceTableName} columns: ${colNames.join(', ')}`);

    // Detect wholesale, special and cost column names
    const wCol = colNames.find(c => ['PRICE2','WPRICE','WHLPRICE','WHOLESALE','W_PRICE','PRICE_W'].includes(c))
              || colNames.find(c => c.includes('WHOLE') || c.includes('WHL'));
    const sCol = colNames.find(c => ['PRICE3','SPRICE','SPECPRICE','SPECIAL','S_PRICE','PRICE_S'].includes(c))
              || colNames.find(c => c.includes('SPEC') || (c.includes('PRICE') && c !== 'PRICE1' && c !== (wCol || '')));
    // Cost/buying price column — used to supplement the GRN-derived costMap
    const cstCol = colNames.find(c => ['UPRICE','COST','BPRICE','CPRICE','BUY_PRICE','BUYPRICE','BUYING_PRICE'].includes(c))
              || colNames.find(c => c.startsWith('UPRICE') || (c.startsWith('COST') && !c.includes('DISC')));
    const codeCol = colNames.includes('CODE') ? 'CODE' : (colNames.find(c => c.includes('CODE')) || 'CODE');

    if (wCol || sCol || cstCol) {
      const selectCols = [
        `\`${codeCol}\` AS sku`,
        wCol   ? `\`${wCol}\` AS wholesale`   : 'NULL AS wholesale',
        sCol   ? `\`${sCol}\` AS special`     : 'NULL AS special',
        cstCol ? `\`${cstCol}\` AS sitemsCost` : 'NULL AS sitemsCost',
      ].join(', ');
      const sitemsRows = await query(conn,
        `SELECT ${selectCols} FROM \`${priceTableName}\` WHERE \`${codeCol}\` IS NOT NULL`);
      let sitemsNewCost = 0;
      for (const r of sitemsRows) {
        const sku = (r.sku || '').trim();
        if (!sku) continue;
        priceMap[sku] = {
          wholesale: r.wholesale > 0 ? Number(r.wholesale) : null,
          special:   r.special   > 0 ? Number(r.special)   : null,
        };
        // Fill costMap for products not already covered by recent GRNs
        if (Number(r.sitemsCost) > 0 && !(sku in costMap)) {
          costMap[sku] = Number(r.sitemsCost);
          sitemsNewCost++;
        }
      }
      log(`Price map: ${Object.keys(priceMap).length} SKUs (wholesale=${wCol||'n/a'}, special=${sCol||'n/a'}, cost=${cstCol||'n/a'}, +${sitemsNewCost} costs from sitems)`);
    } else {
      log("sitems: no price/cost columns detected. Available: " + colNames.join(', '));
    }
  } catch (e) {
    log("sitems price query skipped: " + e.message);
  }

  const products = soldProducts.map(p => {
    const sku = (p.sku || '').trim(); // trim trailing spaces
    return {
      sku,
      name:           p.name,
      price:          Number(p.price),
      cost:           costMap[sku] ?? 0,
      wholesalePrice: priceMap[sku]?.wholesale ?? null,
      specialPrice:   priceMap[sku]?.special   ?? null,
      category:       p.category || "Uncategorised",
      stockQty:       Math.max(0, Math.round((stockMap[sku] ?? stockMap[p.sku]) ?? 0)),
    };
  });

  return { products, costMap, stockMap };
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

// ── Supplier master sync ───────────────────────────────────────
// Runs on the same throttle as the product catalogue (su is a small,
// rarely-changing master table — one cheap query, no join, no scan).
async function syncSuppliers(conn) {
  const rows = await query(conn, "SELECT code, names, active FROM su WHERE active = 1");
  if (!rows.length) return;
  const r = await apiPost("/sync/mirror/reference",
    { table: "su", rows: rows.map(cleanRow) }, SECRET);
  if (r.status === 200) log(`Suppliers synced: ${rows.length}`);
  else log(`Supplier sync failed [${r.status}]: ${r.body.slice(0, 120)}`);
}

// ── Remote receipt printing ───────────────────────────────────
// Triggered by a print_receipt pending change from the dashboard POS.
// Formats the receipt as plain text and sends it to the Windows default
// printer via PowerShell Out-Printer — silent, no window, no extra packages.
// Convert a number to KES words (e.g. 700 → "Seven Hundred only.")
function amtInWords(n) {
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
                 "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen",
                 "Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function below1000(x) {
    if (x === 0) return "";
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x/10)] + (x%10 ? " " + ones[x%10] : "");
    return ones[Math.floor(x/100)] + " Hundred" + (x%100 ? " " + below1000(x%100) : "");
  }
  const whole = Math.floor(n);
  if (whole === 0) return "Zero only.";
  let w = "";
  if (whole >= 1000000) w += below1000(Math.floor(whole/1000000)) + " Million ";
  if (whole >= 1000)    w += below1000(Math.floor((whole%1000000)/1000)) + " Thousand ";
  w += below1000(whole % 1000);
  return w.trim() + " only.";
}

async function printReceipt(payload) {
  const { receiptNo, date, items = [], total, amountPaid, changeDue,
          paymentDetails = {}, ref, staff, vatRate = 16 } = payload;

  // VAT-inclusive breakdown (same as FumasV5)
  const vatAmount = Math.round(Number(total) * vatRate / (100 + vatRate));
  const netAmount = Number(total) - vatAmount;

  // W=32 is conservative — safe even when Out-Printer uses wide margins/fonts.
  // FumasV5 uses raw ESC/POS (48 chars) but we go through the Windows driver.
  const W = 32;
  const hr  = "-".repeat(W);
  const dhr = "=".repeat(W);
  const center = s => {
    const pad = Math.max(0, Math.floor((W - s.length) / 2));
    return " ".repeat(pad) + s;
  };
  const row = (l, r) => {
    const right = String(r);
    const left  = String(l).slice(0, W - right.length - 1).padEnd(W - right.length - 1);
    return left + " " + right;
  };
  const kes = n => "KES " + Number(n).toLocaleString("en-KE");

  const lines = [
    dhr,
    center("MWALIMU COSMETICS"),
    center("P.O. Box, Nairobi"),
    dhr,
    "Date: " + new Date(date).toLocaleString("en-KE", { day:"2-digit", month:"short", year:"numeric" }),
    "Time: " + new Date(date).toLocaleTimeString("en-KE"),
    "Receipt: " + (receiptNo || "PENDING"),
    ...(staff ? ["Cashier: " + staff] : []),
    hr,
    // Items: name on its own line, qty x price = total indented below
    ...items.flatMap(i => {
      const name  = (i.name || "Item").slice(0, W);
      const price = Number(i.unitPrice);
      const qty   = Number(i.qty);
      return [
        name,
        `  ${qty} x ${kes(price)} = ${kes(qty * price)}`,
      ];
    }),
    hr,
    row("Net (excl.VAT):", kes(netAmount)),
    row("VAT " + vatRate + "%:", kes(vatAmount)),
    row("GROSS TOTAL:", kes(total)),
    ...(payload.withholdingTax > 0 ? [
      row("Less WHT (2% net):", "-" + kes(payload.withholdingTax)),
      row("AMOUNT COLLECTED:", kes(Number(total) - Number(payload.withholdingTax))),
      ...(payload.customerPin ? [row("Cust. PIN:", payload.customerPin)] : []),
    ] : []),
    hr,
    ...Object.entries(paymentDetails)
      .filter(([k, v]) => v > 0 && k !== "ref")
      .map(([k, v]) => row(k.toUpperCase() + ":", kes(v))),
    ...(ref ? ["Ref: " + ref] : []),
    row("PAID:", kes(amountPaid)),
    ...(changeDue > 0 ? [row("CHANGE:", kes(changeDue))] : []),
    hr,
    amtInWords(Number(amountPaid)),
    hr,
    center("Thank you for shopping!"),
    dhr,
    "", "", "", "", "", "", "", "", // 8 feed lines
  ];

  const text = lines.join("\r\n");
  const tmpFile = "C:\\MwalimuSync\\last_receipt.txt";
  const ps1File = "C:\\MwalimuSync\\print_receipt.ps1";
  const exec = require("child_process").exec;

  try {
    fs.writeFileSync(tmpFile, text, "ascii");

    // Find default printer via WMI (works from SYSTEM account)
    let printerName = null;
    try {
      const wmicOut = await new Promise((res) =>
        exec('wmic printer where "Default=True" get Name /format:list',
          { timeout: 6000 }, (_, stdout) => res(stdout || ""))
      );
      const m = wmicOut.match(/Name=(.+)/);
      if (m) printerName = m[1].trim();
    } catch {}

    if (printerName) {
      // Expose printer to SYSTEM account
      await new Promise(res =>
        exec(`rundll32 printui.dll,PrintUIEntry /ga /n "${printerName}"`,
          { timeout: 8000 }, () => res())
      );
    }

    // Use System.Drawing.Printing with Courier New 8pt — monospace font
    // that preserves our exact padding/alignment on thermal paper.
    // Out-Printer uses GDI with proportional fonts which breaks the layout.
    const safePrinter = (printerName || "").replace(/'/g, "''").replace(/"/g, '""');
    const psScript = `
Add-Type -AssemblyName System.Drawing
$lines = [System.IO.File]::ReadAllLines('${tmpFile.replace(/\\/g, "\\\\")}', [System.Text.Encoding]::ASCII)
$font = New-Object System.Drawing.Font('Courier New', 8, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
$brush = [System.Drawing.Brushes]::Black
$doc = New-Object System.Drawing.Printing.PrintDocument
${printerName ? `$doc.PrinterSettings.PrinterName = '${safePrinter}'` : ""}
$printLines = $lines
$doc.add_PrintPage({
    $g = $_.Graphics
    $lineH = $font.GetHeight($g)
    $y = 2.0
    foreach ($line in $printLines) {
        $g.DrawString($line, $font, $brush, 2.0, $y)
        $y += $lineH
    }
    $_.HasMorePages = $false
})
$doc.Print()
$doc.Dispose()
$font.Dispose()
`;
    fs.writeFileSync(ps1File, psScript, "utf8");

    await new Promise((res, rej) =>
      exec(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${ps1File}"`,
        { timeout: 30000 },
        (err) => err ? rej(err) : res()
      )
    );
    log(`Receipt printed (Courier New 8pt) on: ${printerName || "default"}`);

  } catch (e) {
    log("Print failed: " + e.message);
    try {
      exec(`notepad /p "${tmpFile}"`);
      log("Receipt sent via notepad fallback.");
    } catch {}
  }
}

// ── Backup: ship today's MySQL tables to Hetzner ─────────────
// Used by the backup_request pending-change type (dashboard "Backup Now" button)
// and by the scheduled daily-backup.js task.
async function runDailyBackup(conn) {
  const today = kenyanDate();
  log(`=== Backup starting for ${today} ===`);

  const tables = [
    { name: "pos_header",          sql: `SELECT * FROM pos_header WHERE DATE(trandate) = ?`,         params: [today] },
    { name: "pos_details",         sql: `SELECT pd.* FROM pos_details pd JOIN pos_header ph ON pd.receiptno = ph.receiptno WHERE DATE(ph.trandate) = ?`, params: [today] },
    { name: "pos_payment_details", sql: `SELECT ppd.* FROM pos_payment_details ppd JOIN pos_header ph ON ppd.receiptno = ph.receiptno WHERE DATE(ph.trandate) = ?`, params: [today] },
    { name: "stran", sql: `SELECT * FROM stran WHERE stdate >= ? AND stdate < ?`, params: [today + " 00:00:00", addDays(today, 1) + " 00:00:00"] },
    { name: "grn",   sql: `SELECT * FROM grn WHERE ddate >= ? AND ddate < ?`,    params: [today + " 00:00:00", addDays(today, 1) + " 00:00:00"] },
  ];

  for (const t of tables) {
    try {
      const rows = await query(conn, t.sql, t.params);
      const clean = rows.map(row => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          if (v === null || v === undefined) out[k] = null;
          else if (v instanceof Date)        out[k] = v.toISOString();
          else if (Buffer.isBuffer(v))       out[k] = v.toString("base64");
          else                               out[k] = v;
        }
        return out;
      });
      const r = await apiPostLarge("/sync/backup", { date: today, table: t.name, rows: clean }, SECRET);
      if (r.status === 200) {
        const parsed = JSON.parse(r.body);
        log(`  ${t.name}: ${parsed.rows} rows backed up.`);
      } else {
        log(`  ${t.name} backup failed [${r.status}]: ${r.body.slice(0, 100)}`);
      }
    } catch (e) {
      log(`  ${t.name} backup error: ${e.message}`);
    }
  }
  log("=== Backup complete ===");
}

// ── On-demand mirror batch ────────────────────────────────────
// Triggered by a mirror_run pending change from the dashboard.
// Syncs up to batchDays of historical MySQL data into PostgreSQL mirror tables.
// Checks the server-side pause flag between dates so the user can stop mid-batch.
const MIRROR_DATE_TABLES = [
  { name: "pos_header",
    sql:  "SELECT * FROM pos_header WHERE DATE(trandate) = ?",
    params: d => [d] },
  { name: "pos_details",
    sql:  `SELECT pd.* FROM pos_details pd
           JOIN pos_header ph ON pd.receiptno = ph.receiptno
           WHERE DATE(ph.trandate) = ?`,
    params: d => [d] },
  { name: "pos_payment_details",
    sql:  `SELECT ppd.* FROM pos_payment_details ppd
           JOIN pos_header ph ON ppd.receiptno = ph.receiptno
           WHERE DATE(ph.trandate) = ?`,
    params: d => [d] },
  { name: "stran",
    sql:  "SELECT * FROM stran WHERE stdate >= ? AND stdate < ?",
    params: d => [d + " 00:00:00", addDays(d, 1) + " 00:00:00"] },
  { name: "grn",
    sql:  "SELECT * FROM grn WHERE ddate >= ? AND ddate < ?",
    params: d => [d + " 00:00:00", addDays(d, 1) + " 00:00:00"] },
  { name: "grn_d",
    sql:  `SELECT gd.* FROM grn_d gd JOIN grn g ON gd.no = g.no
           WHERE DATE(g.ddate) = ?`,
    params: d => [d] },
];

async function isPaused() {
  try {
    const r = await apiRequest("GET", "/sync/mirror/paused", null, SECRET, null, 8000);
    return r.status === 200 && JSON.parse(r.body).paused === true;
  } catch { return false; }
}

// Returns: number of days still pending after this batch (0 = fully caught up)
async function runDailyMirrorBatch(conn, batchDays) {
  batchDays = Number(batchDays) || 60;
  log(`=== Mirror batch starting (${batchDays} days) ===`);

  if (await isPaused()) { log("Mirror is paused — skipping batch."); return 0; }

  // Get watermark from server
  const sr = await apiRequest("GET", "/sync/mirror/status", null, SECRET, null, 10000)
    .catch(() => ({ status: 0, body: '{"lastDate":null}' }));
  if (sr.status !== 200) { log("Cannot reach mirror/status."); return; }
  const { lastDate } = JSON.parse(sr.body);

  const today     = kenyanDate();
  const yesterday = addDays(today, -1);

  let startDate;
  if (lastDate) {
    startDate = addDays(lastDate, 1);
  } else {
    try {
      const [row] = await query(conn,
        "SELECT DATE(MIN(trandate)) AS earliest FROM pos_header WHERE trandate IS NOT NULL", []);
      startDate = row?.earliest
        ? new Date(row.earliest).toISOString().slice(0, 10)
        : addDays(today, -365);
    } catch { startDate = addDays(today, -365); }
    log(`Historical mirror starts from ${startDate}`);
  }

  if (startDate > yesterday) { log("Mirror is fully up to date."); return 0; }

  const allPending  = getDatesRange(startDate, yesterday);
  const batch       = allPending.slice(0, batchDays);
  const afterBatch  = allPending.length - batch.length;

  log(`Syncing ${batch.length} days: ${batch[0]} → ${batch[batch.length - 1]}` +
      (afterBatch > 0 ? ` (${afterBatch} days remain after this batch)` : " — will be fully caught up"));

  let lastSuccessful = lastDate;

  for (let i = 0; i < batch.length; i++) {
    const date = batch[i];

    // Check pause flag every 3 dates so user can stop mid-batch
    if (i > 0 && i % 3 === 0 && await isPaused()) {
      log(`Paused by user at ${date} (${i} of ${batch.length} dates done).`);
      break;
    }

    log(`  [${i + 1}/${batch.length}] ${date}`);
    let dateOk = true;

    for (const t of MIRROR_DATE_TABLES) {
      try {
        const rows  = await query(conn, t.sql, t.params(date), 30000);
        const clean = rows.map(cleanRow);

        // Upload in chunks of 500 rows to avoid 502 gateway errors on large tables
        const CHUNK = 500;
        let tableOk = true;
        for (let ci = 0; ci < Math.max(1, Math.ceil(clean.length / CHUNK)); ci++) {
          const chunk = clean.slice(ci * CHUNK, (ci + 1) * CHUNK);
          const r = await apiRequest("POST", "/sync/mirror/rows",
            { table: t.name, date, rows: chunk }, SECRET, null, 120000);
          if (r.status !== 200) {
            log(`    [!] ${t.name} chunk ${ci + 1}: server error ${r.status}`);
            tableOk = false; break;
          }
        }
        if (tableOk) {
          log(`    ${t.name}: ${clean.length} rows`);
        } else {
          dateOk = false;
        }
      } catch (e) {
        log(`    [!] ${t.name}: ${e.message}`); dateOk = false;
      }
    }

    if (dateOk) { lastSuccessful = date; }
    else { log(`Stopping at ${date} due to error.`); break; }
  }

  // Advance watermark
  if (lastSuccessful && lastSuccessful !== lastDate) {
    await apiRequest("POST", "/sync/mirror/status",
      { lastDate: lastSuccessful }, SECRET, null, 10000).catch(() => {});
    log(`Watermark → ${lastSuccessful}`);
  }

  log(`=== Mirror batch complete${afterBatch > 0 ? ` — ${afterBatch} days still pending` : " — history fully mirrored"} ===`);
  return afterBatch; // caller uses this to decide whether to auto-queue next batch
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
        // Single product quantity adjustment — writes to stran ledger
        const { sku, delta, name, reason } = change.payload;
        await query(conn,
          `INSERT INTO stran (CODE, descr, stdate, qty, tt, trandesc, staff, source)
           VALUES (?, ?, CURDATE(), ?, 'ADJ', ?, 'WEB', 'WEB')`,
          [sku, name || sku, Number(delta), reason || "Web stock adjustment"]);

      } else if (change.type === "fumas_update") {
        // Download and stage FumasV5.exe via the pending changes path.
        // Uses the 120-second apiPostLarge timeout rather than the 8-second
        // startup check — works even on intermittent connections.
        try {
          log("Downloading FumasV5 update…");
          const vr = await apiRequest("GET", "/sync/agent/FumasV5-version", null, null, null, 20000);
          if (vr.status !== 200) { log("FumasV5 version check failed: " + vr.status); break; }
          const serverVer = JSON.parse(vr.body).version;
          const localVer  = fs.existsSync(FUMAS_VER_FILE)
            ? fs.readFileSync(FUMAS_VER_FILE, "utf8").trim() : "";
          if (serverVer === localVer) { log("FumasV5 already up to date (" + serverVer + ")."); break; }
          log("Downloading FumasV5 " + serverVer + " (" + Math.round(33000000/1024/1024) + "MB)…");
          const dl = await apiRequest("GET", "/sync/agent/FumasV5.exe", null, null, null, 300000);
          if (dl.status !== 200) { log("FumasV5 download failed: " + dl.status); break; }
          fs.writeFileSync(FUMAS_NEW, dl.body, "binary");
          fs.writeFileSync(FUMAS_VER_FILE, serverVer, "utf8");
          log("FumasV5 " + serverVer + " staged — will apply next time launch-pos.bat is run.");
        } catch (e) { log("FumasV5 update error: " + e.message); }

      } else if (change.type === "schema_probe") {
        // Phase 0 ground-truth capture for the replacement desktop system.
        // Strictly read-only: it runs SHOW and SELECT statements only.
        //
        // Fetches the current probe and its credential helper, then runs it in
        // a separate process so a fault in the probe cannot take down the sync
        // loop. The probe ships its own results to the server and also leaves
        // a local copy.
        try {
          log("Downloading schema probe…");
          for (const name of ["db-config.js", "schema-probe.js"]) {
            const dl = await apiRequest("POST", "/sync/agent/get-file", { filename: name }, null, null, 60000);
            if (dl.status !== 200) { log(`${name} download failed: ${dl.status}`); throw new Error(name); }
            fs.writeFileSync("C:\\MwalimuSync\\" + name, dl.body, "utf8");
          }

          // payload.args lets a run be narrowed, e.g. { args: ["--only","engines"] },
          // so a retry need not repeat the expensive full-schema capture.
          const probeArgs = Array.isArray(change.payload && change.payload.args)
            ? change.payload.args.map(String) : [];
          log(`Running schema probe (read-only) ${probeArgs.join(" ")}…`);
          const { execFile } = require("child_process");
          await new Promise(resolve => {
            execFile(process.execPath, ["C:\\MwalimuSync\\schema-probe.js", ...probeArgs],
              { cwd: "C:\\MwalimuSync", timeout: 600000, maxBuffer: 20 * 1024 * 1024 },
              (err, stdout, stderr) => {
                (stdout || "").split("\n").filter(Boolean).forEach(l => log("  probe| " + l.trim()));
                if (err) log("Schema probe failed: " + err.message + " " + (stderr || "").slice(0, 500));
                else     log("Schema probe finished.");
                resolve();
              });
          });
        } catch (e) { log("Schema probe error: " + e.message); }

      } else if (change.type === "provision_db_user") {
        // Create a least-privilege MySQL account for this PC and write its
        // credentials to db-config.json, so the scripts stop using the root
        // login that is sitting in this repository's git history.
        //
        // Additive and safe to run while trading: it creates a new account
        // and changes nothing about how existing software connects. Notably
        // it does NOT touch root, which FumasV5 uses from every till.
        try {
          for (const name of ["db-config.js", "provision-db-user.js"]) {
            const dl = await apiRequest("POST", "/sync/agent/get-file", { filename: name }, null, null, 60000);
            if (dl.status !== 200) { log(`${name} download failed: ${dl.status}`); throw new Error(name); }
            fs.writeFileSync("C:\\MwalimuSync\\" + name, dl.body, "utf8");
          }

          const role = (change.payload && change.payload.role) || "sync";
          log(`Provisioning MySQL role '${role}'…`);
          const { execFile } = require("child_process");
          await new Promise(resolve => {
            execFile(process.execPath, ["C:\\MwalimuSync\\provision-db-user.js", role],
              { cwd: "C:\\MwalimuSync", timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
              (err, stdout, stderr) => {
                // A failing GRANT ... IDENTIFIED BY can come back with the
                // generated password echoed inside the driver's error text.
                // These lines are relayed to the server log, so redact first.
                const redact = s => String(s || "").replace(/IDENTIFIED BY\s+'[^']*'/gi, "IDENTIFIED BY '<redacted>'");
                redact(stdout).split("\n").filter(Boolean).forEach(l => log("  provision| " + l.trim()));
                if (err) log("Provisioning failed: " + redact(err.message).slice(0, 300) + " " + redact(stderr).slice(0, 500));
                else     log("Provisioning finished.");
                resolve();
              });
          });
        } catch (e) { log("Provisioning error: " + e.message); }

      } else if (change.type === "print_receipt") {
        await printReceipt(change.payload);

      } else if (change.type === "return_sale") {
        // Reverse a web sale: creates a return receipt in MySQL and restores stock
        const { mysqlReceiptNo, items = [], staff = "WEB", originalReceiptNo } = change.payload;

        // Next sequential receipt number (return gets its own number)
        const [maxRct] = await query(conn,
          "SELECT MAX(CAST(receiptno AS UNSIGNED)) AS maxno FROM pos_header WHERE receiptno REGEXP '^[0-9]+$'");
        const retRctNo = String((Number(maxRct?.maxno) || 0) + 1).padStart(8, "0");
        const now = new Date(Date.now() + 3 * 60 * 60 * 1000)
          .toISOString().slice(0, 19).replace("T", " ");
        const retTotal = items.reduce((s, i) => s + Number(i.unitPrice) * Number(i.qty), 0);

        // Return header (is_return=1, links back to original via notes)
        await query(conn,
          `INSERT INTO pos_header
             (receiptno,amount,paid,changee,tax,staff,tyype,trandate,posdate,
              cash,mpesa,creditcard,cheque,posted,is_return,disc,notes)
           VALUES (?,?,?,0,0,?,'Return',?,?,0,0,0,0,1,1,0,?)`,
          [retRctNo, retTotal, retTotal, staff, now.slice(0, 10), now,
           "Return of " + (originalReceiptNo || mysqlReceiptNo || "web order")]);

        // Return line items + stock restoration
        for (const item of items) {
          const lineTotal = Number(item.unitPrice) * Number(item.qty);
          await query(conn,
            `INSERT INTO pos_details
               (receiptno,code,description,qty,price,total,vat,posted,disc)
             VALUES (?,?,?,?,?,?,0,1,0)`,
            [retRctNo, item.sku, item.name, Number(item.qty),
             Number(item.unitPrice), lineTotal]);

          // Positive qty in stran = stock returned to shelf
          await query(conn,
            `INSERT INTO stran (CODE,descr,stdate,qty,price,total,tt,trandesc,staff,source)
             VALUES (?,?,CURDATE(),?,?,?,'RETURN','Sales Return',?,'WEB')`,
            [item.sku, item.name, Number(item.qty),
             Number(item.unitPrice), lineTotal, staff]);
        }
        log(`Return receipt ${retRctNo} created (reverses ${originalReceiptNo || "web order"}).`);

      } else if (change.type === "backup_request") {
        await runDailyBackup(conn);

      } else if (change.type === "mirror_run") {
        const { batchDays = 60, autoContinue = false } = change.payload || {};
        const remaining = await runDailyMirrorBatch(conn, batchDays);
        // Auto-queue next batch ONLY when autoContinue was explicitly set.
        // In normal operation (autoContinue=false) each batch is one-shot —
        // the user decides when to run the next one from the History page.
        if (autoContinue && remaining > 0 && !(await isPaused())) {
          await apiRequest("POST", "/sync/pending-changes",
            { type: "mirror_run", payload: { batchDays, autoContinue: true } },
            null, token, 10000).catch(() => {});
          await apiRequest("POST", "/sync/request", {}, null, token, 10000).catch(() => {});
          log(`Auto-queued next batch (${remaining} days remaining).`);
        } else if (remaining === 0) {
          log("Mirror upload complete — all historical data is on Hetzner.");
        } else if (!autoContinue && remaining > 0) {
          log(`Batch done. ${remaining} days still pending — click Continue on History page for next batch.`);
        }

      } else if (change.type === "goods_received") {
        // Goods received note — writes grn header, grn_d lines, and stran entries.
        // supplierCode is optional for backward compatibility with older
        // dashboard builds that only sent free-text supplierName; when present
        // it links the GRN to a real su row so AP payments can reference it.
        const { supplierName, supplierCode, lines } = change.payload;

        let scode = "WEB";
        let sname = supplierName || "Web Entry";
        if (supplierCode) {
          const [su] = await query(conn,
            "SELECT code, names FROM su WHERE code = ? AND active = 1", [supplierCode]);
          if (su) { scode = su.code; sname = su.names || sname; }
        }

        // Generate a unique WEB-prefixed GRN number (separate from POS GRN sequence)
        const [maxGrn] = await query(conn,
          "SELECT MAX(CAST(SUBSTRING(no, 4) AS UNSIGNED)) AS maxno FROM grn WHERE no LIKE 'WEB%'");
        const grnNo = `WEB${String((Number(maxGrn?.maxno) || 0) + 1).padStart(6, "0")}`;
        const today = kenyanDate();
        const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.costPrice), 0);

        // GRN header
        await query(conn,
          `INSERT INTO grn (no, scode, sname, ddate, posted, screate, dcreate, gtotal, exclvat)
           VALUES (?, ?, ?, ?, 1, 'WEB', NOW(), ?, ?)`,
          [grnNo, scode, sname, today, Math.round(total), Math.round(total)]);

        for (const line of lines) {
          const lineTotal = Number(line.qty) * Number(line.costPrice);
          // GRN detail line
          await query(conn,
            `INSERT INTO grn_d (no, code, descr, qty, uprice, total) VALUES (?, ?, ?, ?, ?, ?)`,
            [grnNo, line.sku, line.name, Number(line.qty),
             Number(line.costPrice), Math.round(lineTotal)]);
          // Stock movement — positive qty = stock received
          await query(conn,
            `INSERT INTO stran (CODE, descr, stdate, qty, price, total, tt, trandesc, staff, source)
             VALUES (?, ?, ?, ?, ?, ?, 'r', 'Goods Received', 'WEB', 'WEB')`,
            [line.sku, line.name, today, Number(line.qty),
             Number(line.costPrice), Math.round(lineTotal)]);
        }
        log(`  GRN ${grnNo}: ${lines.length} line(s), KES ${Math.round(total).toLocaleString("en-KE")}`);

        // Push the new GRN straight into the mirror so it shows up in the
        // dashboard's GRN picker immediately, without waiting for the next
        // scheduled/on-demand mirror batch.
        await apiPost("/sync/mirror/rows", {
          table: "grn", date: today,
          rows: [{ no: grnNo, ddate: today, scode, sname, posted: 1, gtotal: Math.round(total) }],
        }, SECRET).catch(e => log("  mirror push (grn) skipped: " + e.message));

      } else if (change.type === "grn_payment") {
        // Instalment cheque/cash/bank-transfer payment against a GRN — posts
        // into FumasV5's real AP ledger (see GRN_PAYMENT_DB).
        await postGrnPayment(change.payload);

      } else {
        // Unrecognized change type — fail loudly rather than silently marking
        // it "applied" while doing nothing (that used to happen here, since
        // the mark-change-applied call below ran unconditionally regardless
        // of whether any branch above matched).
        throw new Error(`Unknown change type: ${change.type}`);
      }

      await apiPost("/sync/mark-change-applied", { id: change.id }, SECRET);
      log(`  Applied [${change.type}]`);
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

    // WHT (withholding tax) — stored in pos_header.levy
    const levyAmount = Number(pd.withholdingTax || 0);
    const arname     = pd.customerPin ? `WHT:${pd.customerPin}` : "";

    try {
      await new Promise((res, rej) => conn.query(
        `INSERT INTO pos_header
           (receiptno,amount,paid,changee,tax,staff,arcode,arname,tyype,
            trandate,posdate,cash,mpesa,creditcard,cheque,posted,is_return,disc,levy,csale)
         VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,1,0,0,?,?)`,
        [rctNo, sale.total, sale.amountPaid, sale.changeDue,
         sale.staffCode || "WEB", "", arname, tyype, now.slice(0, 10), now,
         Number(pd.cash || 0), Number(pd.mpesa || 0), 0, 0,
         levyAmount, levyAmount > 0 ? 1 : 0],
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

// ── One-time test database setup ──────────────────────────────
// Creates a lightweight mwalimuinvest_test database for safely testing the
// upcoming GRN-payment posting logic (journal_transactions/creditors_transactions)
// without touching real accounting data. Gated by a checkpoint flag so this
// runs exactly once, ever, then becomes a no-op. Only copies small reference
// tables (never pos_header/pos_details/stran) to keep the one-time cost cheap.
async function setupTestDatabase() {
  const cp = loadCheckpoint();
  if (cp.testDbReady) return;

  log("=== One-time test database setup starting ===");
  const conn = await openConn().catch(e => { log("Test DB setup: MySQL connect failed: " + e.message); return null; });
  if (!conn) return;

  try {
    await query(conn, "CREATE DATABASE IF NOT EXISTS mwalimuinvest_test");

    // Small reference/master tables, copied in full — needed for the posting
    // logic to resolve real GL accounts, currency, periods, and auto-numbers.
    const REFERENCE_TABLES = ["su", "accounts", "currency", "currency_periods", "periods", "nauto"];
    for (const t of REFERENCE_TABLES) {
      try {
        const exists = await query(conn, "SHOW TABLES LIKE ?", [t]);
        if (!exists.length) { log(`  skip ${t}: not found`); continue; }
        await query(conn, `CREATE TABLE IF NOT EXISTS mwalimuinvest_test.${t} LIKE mwalimuinvest.${t}`);
        const [{ cnt }] = await query(conn, `SELECT COUNT(*) AS cnt FROM mwalimuinvest_test.${t}`);
        if (Number(cnt) === 0) {
          await query(conn, `INSERT INTO mwalimuinvest_test.${t} SELECT * FROM mwalimuinvest.${t}`);
        }
        log(`  ${t}: copied`);
      } catch (e) { log(`  ${t} copy failed (non-fatal): ${e.message}`); }
    }

    // Posting-target tables — schema only, left empty so test postings start
    // from a clean slate. No real transaction history needed for this.
    const EMPTY_TABLES = ["grn", "grn_d", "ap_prepayment", "creditors_transactions", "journal_transactions"];
    for (const t of EMPTY_TABLES) {
      try {
        const exists = await query(conn, "SHOW TABLES LIKE ?", [t]);
        if (!exists.length) { log(`  skip ${t}: not found`); continue; }
        await query(conn, `CREATE TABLE IF NOT EXISTS mwalimuinvest_test.${t} LIKE mwalimuinvest.${t}`);
        log(`  ${t}: schema ready (empty)`);
      } catch (e) { log(`  ${t} schema copy failed (non-fatal): ${e.message}`); }
    }

    // One synthetic supplier + one synthetic GRN (KES 2,000,000) — enough to
    // test the 10-instalment cheque scenario without touching real data.
    const today = kenyanDate();
    await query(conn,
      `INSERT IGNORE INTO mwalimuinvest_test.su (code, names, active) VALUES ('TESTSUP01','Test Supplier (Instalment Demo)',1)`);
    await query(conn,
      `INSERT IGNORE INTO mwalimuinvest_test.grn (no, scode, sname, ddate, posted, screate, dcreate, gtotal, exclvat)
       VALUES ('TEST000001','TESTSUP01','Test Supplier (Instalment Demo)',?,1,'WEB',NOW(),2000000,2000000)`,
      [today]);
    await query(conn,
      `INSERT IGNORE INTO mwalimuinvest_test.grn_d (no, code, descr, qty, uprice, total)
       VALUES ('TEST000001','TESTSKU','Test Line Item — Instalment Demo',1,2000000,2000000)`);

    log("=== Test database ready: mwalimuinvest_test (test GRN TEST000001, KES 2,000,000) ===");
    saveCheckpoint({ ...cp, testDbReady: true });
  } catch (e) {
    log("Test DB setup failed: " + e.message);
  } finally {
    conn.end();
  }
}

// ── GRN instalment payments → FumasV5's real AP ledger ────────
// Replicates FPrepayment_creditors.cs's post_PAYMENT_roll() flow exactly
// (Source Code/FumasV5/FPrepayment_creditors.cs:973-1023, plus
// mglobal.do_gl_journal_roll/do_gl_Creditors_roll): two GL journal legs
// (cash/bank credit + AP control-account debit), a creditor subledger
// entry, the ap_prepayment voucher, and the creditor's running
// accounts.prepaid balance — all in one DB transaction so a partial
// failure can never leave the books unbalanced.
//
// LIVE as of 2026-07-31: verified against mwalimuinvest_test (6 test
// postings, all journal legs balanced, creditors_transactions matched
// accounts.prepaid exactly, overpayment guard rejected correctly twice —
// see agent logs) and approved to point at the real database.
const GRN_PAYMENT_DB = MYSQL.database;

function openTestConn() {
  return new Promise((res, rej) => {
    const c = mysql.createConnection({ ...MYSQL, database: GRN_PAYMENT_DB });
    c.connect(e => e ? rej(e) : res(c));
  });
}

function beginTx(conn)    { return new Promise((res, rej) => conn.beginTransaction(e => e ? rej(e) : res())); }
function commitTx(conn)   { return new Promise((res, rej) => conn.commit(e => e ? rej(e) : res())); }
function rollbackTx(conn) { return new Promise(res => conn.rollback(() => res())); }

async function getNautoSetting(conn, col) {
  const [row] = await query(conn, `SELECT ${col} AS v FROM nauto`);
  return row?.v ?? "";
}

async function getActivePeriod(conn) {
  const [row] = await query(conn,
    `SELECT period FROM currency_periods WHERE active = 'YES' ORDER BY period DESC LIMIT 1`).catch(() => []);
  return row?.period ?? "";
}

async function isPeriodLocked(conn, dateStr) {
  const [row] = await query(conn,
    `SELECT locked FROM periods WHERE yr = YEAR(?) AND period = MONTH(?)`, [dateStr, dateStr]).catch(() => null);
  return !!row && String(row.locked).toUpperCase() !== "NO";
}

// Mirrors mglobal.get_control_ac: supplier's own glcategory mapping, then
// the currency's default creditors account, then the global default.
async function getControlAc(conn, ccode) {
  try {
    const [row] = await query(conn,
      `SELECT b.accountcode AS ac FROM su a, glcategory b
       WHERE a.glcategory = b.code AND a.code = ? AND b.code <> ''`, [ccode]);
    if (row?.ac) return row.ac;
  } catch {}
  try {
    const currency = await getNautoSetting(conn, "currency_s");
    const [row] = await query(conn, `SELECT creditorsac AS ac FROM currency WHERE code = ?`, [currency]);
    if (row?.ac) return row.ac;
  } catch {}
  const fallback = await getNautoSetting(conn, "creditorsacct");
  return fallback || "SUSPENSE";
}

// Mirrors mglobal.get_auto_new("PREP-PAY", "Yes")
async function getNextPrepayNo(conn) {
  await query(conn, "UPDATE nauto SET prepaid = prepaid + 1");
  const [row] = await query(conn, "SELECT CONCAT(pprepaid, prepaid) AS pno FROM nauto");
  return row.pno;
}

async function postGrnPayment(payload) {
  const { grnNo, supplierCode, method, amount: rawAmount, chequeNo, paymentDate, remarks } = payload;
  const amount = Number(rawAmount);

  if (!supplierCode) throw new Error("Payment requires a linked supplier — this GRN doesn't reference a real supplier code.");
  if (!(amount > 0)) throw new Error("Payment amount must be greater than 0.");
  if (!grnNo || !paymentDate) throw new Error("grnNo and paymentDate are required.");

  const conn = await openTestConn();
  try {
    const [grn] = await query(conn, "SELECT no, gtotal FROM grn WHERE no = ?", [grnNo]);
    if (!grn) throw new Error(`GRN ${grnNo} not found in ${GRN_PAYMENT_DB}.`);

    const [supplier] = await query(conn, "SELECT code, names FROM su WHERE code = ? AND active = 1", [supplierCode]);
    if (!supplier) throw new Error(`Supplier ${supplierCode} not found or inactive in ${GRN_PAYMENT_DB}.`);

    // Additive safety FumasV5 itself doesn't have (FOutgoing_cheques.cs has
    // no amount-vs-balance check either): don't let instalments overpay the
    // invoice. Matched via the "GRN <no>" tag written into ap_prepayment.remarks.
    const [{ paidSoFar }] = await query(conn,
      `SELECT COALESCE(SUM(amount), 0) AS paidSoFar FROM ap_prepayment WHERE ccode = ? AND remarks LIKE ? AND posted = 1`,
      [supplierCode, `GRN ${grnNo}%`]);
    if (Number(paidSoFar) + amount > Number(grn.gtotal) + 0.5) {
      throw new Error(`Payment would exceed GRN ${grnNo}'s balance (already paid ${paidSoFar} of ${grn.gtotal}).`);
    }

    if (await isPeriodLocked(conn, paymentDate)) {
      throw new Error(`Accounting period for ${paymentDate} is locked.`);
    }

    const rtype       = method === "CASH" ? "C" : method === "BANK" ? "S" : "Q";
    const cashAccount = await getNautoSetting(conn, "cashaccount");
    const currency    = await getNautoSetting(conn, "currency_s");
    const cperiod     = await getActivePeriod(conn);
    const controlAc   = await getControlAc(conn, supplierCode);
    const chequeReal  = chequeNo || "";

    const [accRow] = await query(conn, "SELECT prepaid FROM accounts WHERE code = ?", [supplierCode]).catch(() => []);
    const balbf = accRow?.prepaid ?? 0;
    const remarksFull = `GRN ${grnNo}${remarks ? " — " + remarks : ""} Payment`;

    await beginTx(conn);
    try {
      const pno = await getNextPrepayNo(conn);

      // 1) GL journal — cash/bank leg (credit: money going out of the till/bank)
      await query(conn,
        `INSERT INTO journal_transactions
           (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,cost_center,dcurrency_s,cperiod,rate)
         VALUES (?,?,?,?,?,?,?,NOW(),'-','n',0,?,?,'',?,?,1)`,
        [cashAccount, remarksFull, amount, paymentDate, pno, "AP-PAYMENT", "WEB", rtype, chequeReal, currency, cperiod]);

      // 2) GL journal — AP control-account leg (debit)
      await query(conn,
        `INSERT INTO journal_transactions
           (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,cost_center,dcurrency_s,cperiod,rate)
         VALUES (?,?,?,?,?,?,?,NOW(),'+','n',0,?,?,'',?,?,1)`,
        [controlAc, remarksFull, amount, paymentDate, pno, "AP-PAYMENT", "WEB", rtype, chequeReal, currency, cperiod]);

      // 3) Creditor subledger (cheque_no stored as literal '0' here, matching
      // FumasV5's own behavior — the real cheque number lives on the journal
      // legs and the ap_prepayment header, not on this row)
      await query(conn,
        `INSERT INTO creditors_transactions
           (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,dcurrency_s,cperiod,rate)
         VALUES (?,?,?,?,?,?,?,NOW(),'+','n',0,?,'0',?,?,1)`,
        [supplierCode, remarksFull, amount, paymentDate, pno, "AP-PAYMENT", "WEB", rtype, currency, cperiod]);

      // 4) Payment voucher header — posted immediately (FumasV5 itself always
      // posts on save in practice; see `evpost` in FPrepayment_creditors.cs)
      await query(conn, "DELETE FROM ap_prepayment WHERE pno = ?", [pno]);
      await query(conn,
        `INSERT INTO ap_prepayment
           (pno,pdate,ccode,cname,amount,account,cheque_no,remarks,balbf,prepaid,staff,staffdate,rtype,dcurrency_s,cperiod,rate,csale,posted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,1,1,1)`,
        [pno, paymentDate, supplierCode, supplier.names, amount, cashAccount, chequeReal, remarksFull, balbf, balbf, "WEB", rtype, currency, cperiod]);

      // 5) Creditor's running balance — ensure the accounts row exists first
      // (defensive: a newly-linked supplier may not have one yet), then update.
      await query(conn,
        "INSERT IGNORE INTO accounts (code, description, nb, prepaid, active) VALUES (?, ?, 'Creditors', 0, 1)",
        [supplierCode, supplier.names]);
      await query(conn, "UPDATE accounts SET prepaid = prepaid + ? WHERE code = ?", [amount, supplierCode]);

      await commitTx(conn);
      log(`  GRN payment posted [${GRN_PAYMENT_DB}]: ${pno} — ${method} KES ${amount.toLocaleString("en-KE")} against ${grnNo}`);
      return pno;
    } catch (e) {
      await rollbackTx(conn);
      throw e;
    }
  } finally {
    conn.end();
  }
}

// ── One-time self-test of postGrnPayment ───────────────────────
// Exercises the posting logic against the TEST000001 / TESTSUP01 fixtures
// created by setupTestDatabase(), including the overpayment guard, and
// logs a clear pass/fail summary — verification ahead of ever pointing
// GRN_PAYMENT_DB at production. Gated to run exactly once.
async function runPaymentSelfTest() {
  // Safety net: never post fabricated self-test entries into whatever
  // GRN_PAYMENT_DB currently points at once it's live (e.g. if checkpoint.json
  // is ever wiped by update-agent.bat, this must not silently re-run against
  // the real ledger). Already-completed test runs stay recorded in the log.
  if (GRN_PAYMENT_DB === MYSQL.database) return;

  const cp = loadCheckpoint();
  if (cp.grnPaymentSelfTestV2Done) return;
  if (!cp.testDbReady) return; // wait until the test DB actually exists

  log("=== GRN payment self-test starting (against " + GRN_PAYMENT_DB + ") ===");
  const results = [];

  for (let i = 1; i <= 3; i++) {
    try {
      const pno = await postGrnPayment({
        grnNo: "TEST000001", supplierCode: "TESTSUP01",
        method: i === 2 ? "CHEQUE" : "CASH", amount: 200000,
        chequeNo: i === 2 ? "TESTCHQ001" : undefined,
        paymentDate: kenyanDate(), remarks: `Self-test instalment ${i}/10`,
      });
      results.push(`  [PASS] instalment ${i}: posted as ${pno}`);
    } catch (e) {
      results.push(`  [FAIL] instalment ${i}: ${e.message}`);
    }
  }

  // This one should be rejected: 3 x 200,000 already posted (600,000), the
  // GRN is only 2,000,000, so requesting the full remaining 2,000,000 again
  // must fail the overpayment guard rather than silently posting.
  try {
    await postGrnPayment({
      grnNo: "TEST000001", supplierCode: "TESTSUP01", method: "BANK",
      amount: 2000000, paymentDate: kenyanDate(), remarks: "Self-test overpayment (should be rejected)",
    });
    results.push("  [FAIL] overpayment guard: payment was accepted but should have been rejected");
  } catch (e) {
    results.push(`  [PASS] overpayment guard correctly rejected: ${e.message}`);
  }

  // Read back the actual posted rows rather than just trusting that no
  // error was thrown — confirm each payment's two journal legs net to zero
  // (debits = credits) and the creditor subledger / running balance agree.
  try {
    const vconn = await openTestConn();
    try {
      const jt = await query(vconn,
        `SELECT trancode, SUM(CASE WHEN transign = '+' THEN amount ELSE -amount END) AS net
         FROM journal_transactions WHERE trantype = 'AP-PAYMENT' GROUP BY trancode`);
      for (const r of jt) results.push(`  journal_transactions ${r.trancode}: net ${r.net} (0 = balanced)`);

      const [ct] = await query(vconn,
        "SELECT COALESCE(SUM(amount), 0) AS total FROM creditors_transactions WHERE code = 'TESTSUP01'");
      const [acc] = await query(vconn, "SELECT prepaid FROM accounts WHERE code = 'TESTSUP01'");
      const match = Number(ct.total) === Number(acc?.prepaid ?? -1);
      results.push(`  creditors_transactions total: ${ct.total}  vs  accounts.prepaid: ${acc?.prepaid} — ${match ? "MATCH" : "MISMATCH"}`);

      const apRows = await query(vconn,
        "SELECT pno, amount, rtype, posted FROM ap_prepayment WHERE ccode = 'TESTSUP01' ORDER BY pno");
      results.push(`  ap_prepayment rows: ${apRows.map(r => `${r.pno}(${r.rtype},KES${r.amount},posted=${r.posted})`).join(", ")}`);
    } finally {
      vconn.end();
    }
  } catch (e) {
    results.push(`  [WARN] verification read-back failed: ${e.message}`);
  }

  log("=== GRN payment self-test results ===");
  for (const r of results) log(r);
  log("=== Self-test complete — review the balances above before ever pointing GRN_PAYMENT_DB at production ===");
  saveCheckpoint({ ...cp, grnPaymentSelfTestV2Done: true });
}

// ── Main ─────────────────────────────────────────────────────
async function run() {
  await checkForUpdate();
  await checkFumasUpdate(); // once-daily FumasV5 version check
  await setupTestDatabase().catch(e => log("Test DB setup error: " + e.message));
  await runPaymentSelfTest().catch(e => log("Payment self-test error: " + e.message));

  // Check if a refresh was requested from the dashboard.
  // Use POST — on some networks GET requests time out but POST works reliably.
  const refreshCheck = await apiRequest("POST", "/sync/pending-refresh", {}, SECRET, null, 15000)
    .catch(() => ({ status: 0, body: "{}" }));

  if (refreshCheck.status !== 200) return; // silent — no log (would flood on bad connection)

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
  // buildProducts and buildMetrics use SEPARATE connections so that a
  // timed-out stran query (which can corrupt the connection object) does
  // not cascade and prevent metrics from being pushed.
  const productSyncDue = cp.date !== today || nowMs - (cp.lastProductSync || 0) > 4 * 60 * 60 * 1000;

  let productsData = null;
  let costMap      = cp.costMap  || null;
  let stockMap     = cp.stockMap || null;

  if (productSyncDue) {
    const conn1 = await openConn().catch(() => null);
    if (conn1) {
      const result = await buildProducts(conn1, cp).catch(e => { log("Products build error: " + e.message); return null; });
      if (result) { productsData = result.products; costMap = result.costMap; stockMap = result.stockMap; }
      await syncSuppliers(conn1).catch(e => log("Supplier sync error: " + e.message));
      conn1.end();
    }
  }

  // Fresh connection for metrics — isolated from any buildProducts failure
  let metricsData = null;
  const conn1b = await openConn().catch(e => { log("MySQL connect failed: " + e.message); return null; });
  if (conn1b) {
    log("Connected to MySQL on server-pc.");
    metricsData = await buildMetrics(conn1b, today)
      .catch(e => { log("Metrics build error: " + e.message); return null; });
    conn1b.end();
  }

  // ── Phase 2: push to server ────────────────────────────────────
  let token;
  try { token = await getSyncToken(); } catch (e) { log("Auth failed: " + e.message); }

  let metricsPushed = false;
  if (metricsData) {
    metricsData.agentVersion = AGENT_VERSION;
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
    txCount:         metricsPushed ? 0 : cp.txCount,
    date:            metricsPushed ? today : cp.date,
    lastProductSync: productSyncDue ? nowMs : (cp.lastProductSync || 0),
    costMap:         costMap || cp.costMap || null,
    stockMap:        Object.keys(stockMap || {}).length > 0 ? stockMap : (cp.stockMap || null),
  });
  // Logged at the END of the cycle on purpose. The forwarded log is only the
  // last 60 lines, so anything reported at startup is evicted long before it
  // reaches the server. This line is how we confirm remotely that a PC has
  // actually moved off the root credentials that are in git history.
  log(MYSQL_SOURCE);
  log("=== Sync complete ===");
}

// After every sync attempt (success or failure), forward the log to the
// server so it appears in PM2 logs and can be read remotely for diagnostics.
async function forwardLog() {
  if (!_logLines.length) return;
  try {
    await apiPost("/sync/bridge-log", { entries: _logLines.slice() }, SECRET);
  } catch {}
}

run()
  .then(forwardLog)
  .catch(err => { log("Fatal: " + err.message); forwardLog(); process.exit(1); });
