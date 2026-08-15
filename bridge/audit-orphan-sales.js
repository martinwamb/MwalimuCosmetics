/**
 * Sales that exist only as line items, with no header. READ ONLY by default.
 *
 * A till writes the sale line first and the header afterwards:
 *
 *     FPOS.cs:3554   insert into pos_details ...      <- committed immediately
 *     FPOS.cs:3612   load_temporder()                 <- grid refreshes, looks normal
 *     FPOS.cs:3615   insert into pos_header ...       <- ~60 lines later
 *     FPOS.cs:3706   catch (Exception ex) { }         <- the method's only handler
 *
 * Two tables, two connections, no transaction, and the return value of the
 * header write is never checked. So anything that throws in between leaves the
 * lines committed with no header — and because `FPosList` lists sales out of
 * `pos_header` alone (FPosList.cs:727), the cashier can never see or recall it.
 * Nothing is written to `systemaudit` either: the POS forms only audit success.
 *
 * The known trigger is the posting date. `FPOS.cs:3628` does
 * `Conversions.ToDate(this.ddate.Text)` while building the header INSERT, and
 * `ddate.Text` comes from `mglobal.accounting_date`, a static with no
 * initialiser that is only ever set by `modTime.change_date_time()` — inside
 * its own empty catch. If that has never succeeded in the session the value is
 * null, the conversion throws on every scanned line, and the till loses every
 * sale it rings for the rest of the shift without showing anything at all.
 *
 * This finds them. The scan walks `pos_details` backwards by primary key in
 * bounded chunks, so it is a range read on an index rather than anything the
 * tills will feel, and it never touches `stran` or `sq`.
 *
 * With --rebuild it writes the missing `pos_header` rows back as held sales
 * (posted = 0), which is what puts them in front of the cashier again. That is
 * the only statement here that is not a SELECT, it is off by default, and it
 * should be run after close of business.
 *
 *   node audit-orphan-sales.js [--rows 32000] [--pace 1200]
 *   node audit-orphan-sales.js --rebuild [--confirm]
 *   node audit-orphan-sales.js --receipt gPOS1,GPOS2 --rebuild --confirm
 *
 * `--receipt` narrows everything after the scan to the named receipts. It is
 * how you put one cashier's sale back without touching the other tills, and it
 * also keeps the run cheap: the per-sale lookups below (time, till, items) are
 * the bulk of the queries, and this skips them for everything unnamed.
 */

const mysql = require("mysql");
const fs    = require("fs");
const path  = require("path");

const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");

const MYSQL_CONFIG = getMysqlConfig({ connectTimeout: 15000, dateStrings: true });
const OUT_DIR = path.join(__dirname, "orphans-output");

const argValue = (f, d) => {
  const i = process.argv.indexOf(f);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const hasFlag = (f) => process.argv.includes(f);

const ROWS      = Number(argValue("--rows", 32000));
const PACE_MS   = Number(argValue("--pace", 1200));
const CHUNK     = 4000;
const REBUILD   = hasFlag("--rebuild");
const CONFIRMED = hasFlag("--confirm");
const ONLY      = argValue("--receipt", "").split(",").map(s => s.trim()).filter(Boolean);

/** No statement here should be slow; if one is, stop rather than lean on the server. */
const MAX_STATEMENT_MS = 8000;

const log = (m) => console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${m}`);
const pause = (ms) => new Promise(r => setTimeout(r, ms));
const money = (n) => Math.round(Number(n) || 0).toLocaleString("en-KE");

/** Case-folded and space-trimmed, because receiptno is latin1_swedish_ci. */
const key = (s) => String(s ?? "").trim().toUpperCase();

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r)));
}

async function timed(conn, label, sql, params) {
  await pause(PACE_MS);
  const started = Date.now();
  const rows = await query(conn, sql, params);
  const ms = Date.now() - started;
  if (ms > MAX_STATEMENT_MS) {
    throw new Error(`"${label}" took ${ms}ms — stopping so this cannot affect the tills`);
  }
  return rows;
}

function emit(name, rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const day = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify(rows, null, 2);
  // Date-stamped as well as latest, for the same reason the draft census is:
  // a run that overwrites its own evidence cannot be compared with the next.
  fs.writeFileSync(path.join(OUT_DIR, `${name}-${day}.json`), body);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), body);
}

/**
 * Which cashier a receipt belongs to.
 *
 * The number is built as `left('<usercode>',1) + ppos + pos`
 * (mglobal.cs:17382) from the login exactly as typed, so the initial is the
 * only attribution an orphan carries — its header, which would have held
 * `staff`, is the thing that is missing. Case is preserved by the app, so
 * `maryann` and `MARYWANJIRU` both start an M receipt and can only be told
 * apart by it.
 */
async function cashiersByInitial(conn) {
  const rows = await timed(conn, "recent cashiers",
    `SELECT staff, COUNT(*) AS n
       FROM pos_header
      WHERE trandate >= DATE_SUB(CURDATE(), INTERVAL 45 DAY) AND staff <> ''
      GROUP BY staff ORDER BY n DESC`);

  // Keyed case-insensitively. The login is case-insensitive
  // (SearchClass.cs:168 under latin1_swedish_ci), so the same person signs in
  // as `lucy` one day and `LUCY` the next and their receipts change letter
  // accordingly — while `pos_header.staff` records whichever spelling they
  // used. Matching on case alone therefore loses people. It is also the whole
  // hazard: `maryann` and `MARYWANJIRU` share a letter, and `receiptno` is
  // UNIQUE under that same case-insensitive collation.
  const byInitial = new Map();
  for (const r of rows) {
    const initial = String(r.staff).slice(0, 1).toUpperCase();
    if (!byInitial.has(initial)) byInitial.set(initial, []);
    byInitial.get(initial).push(String(r.staff));
  }
  return byInitial;
}

function attribute(receiptno, byInitial) {
  const letter = String(receiptno).slice(0, 1);
  const candidates = byInitial.get(letter.toUpperCase()) || [];
  // When two cashiers share a letter, the case the till actually used is the
  // only thing that tells them apart, so prefer an exact-case match — but say
  // so, because that is a guess and money is attached to it.
  const exact = candidates.filter(s => s.slice(0, 1) === letter);
  return {
    staff: (exact.length ? exact : candidates)[0] || "",
    ambiguous: candidates.length > 1 ? candidates : null,
  };
}

/**
 * Walk pos_details backwards by primary key, chunk by chunk, and keep the
 * receipts that have no header.
 *
 * A receipt whose lines straddle a chunk boundary would otherwise be counted
 * twice with a split total, so the accumulation is keyed by receipt and merged
 * across chunks rather than reported per chunk.
 */
async function findOrphans(conn) {
  const [{ mx }] = await timed(conn, "newest sale line", "SELECT MAX(posdid) AS mx FROM pos_details");
  const floor = mx - ROWS;
  const found = new Map();

  for (let hi = mx; hi > floor; hi -= CHUNK) {
    const lo = Math.max(hi - CHUNK, floor);

    const groups = await timed(conn, `lines ${lo}-${hi}`,
      `SELECT receiptno, COUNT(*) AS nlines, SUM(total) AS total,
              SUM(vat) AS vat, SUM(disc) AS disc,
              MIN(posdid) AS firstid, MAX(posdid) AS lastid,
              MIN(location) AS location
         FROM pos_details
        WHERE posdid BETWEEN ? AND ? AND receiptno <> '' AND receiptno IS NOT NULL
        GROUP BY receiptno`, [lo, hi]);
    if (!groups.length) continue;

    const names = groups.map(g => g.receiptno);
    const headers = await timed(conn, `headers for ${names.length} receipts`,
      `SELECT receiptno FROM pos_header WHERE receiptno IN (?)`, [names]);
    const have = new Set(headers.map(h => key(h.receiptno)));

    for (const g of groups) {
      if (have.has(key(g.receiptno))) continue;
      const k = key(g.receiptno);
      const prior = found.get(k);
      if (prior) {
        prior.nlines  += Number(g.nlines);
        prior.total   += Number(g.total  || 0);
        prior.vat     += Number(g.vat    || 0);
        prior.disc    += Number(g.disc   || 0);
        prior.firstid  = Math.min(prior.firstid, Number(g.firstid));
        prior.lastid   = Math.max(prior.lastid,  Number(g.lastid));
      } else {
        found.set(k, {
          receiptno: String(g.receiptno),
          nlines: Number(g.nlines),
          total: Number(g.total || 0),
          vat: Number(g.vat || 0),
          disc: Number(g.disc || 0),
          firstid: Number(g.firstid),
          lastid: Number(g.lastid),
          location: String(g.location || "SHOP"),
        });
      }
    }
    log(`  scanned ${lo}-${hi}: ${found.size} orphan(s) so far`);
  }

  return [...found.values()].sort((a, b) => b.total - a.total);
}

/**
 * When the sale was rung.
 *
 * `pos_details` carries no timestamp, so the time is taken from the receipts
 * either side of it in primary-key order — those did get headers, and their
 * `trandate` brackets the lost one to within a few minutes. Good enough to
 * find the shift, the cashier and the till in `systemaudit`.
 */
async function bracketTime(conn, orphan) {
  const near = await timed(conn, `time around ${orphan.receiptno}`,
    `SELECT DISTINCT receiptno FROM pos_details
      WHERE posdid BETWEEN ? AND ? AND receiptno <> ''`,
    [orphan.firstid - 20, orphan.lastid + 20]);

  const [row] = await timed(conn, `bracketing header for ${orphan.receiptno}`,
    `SELECT MIN(trandate) AS at FROM pos_header WHERE receiptno IN (?)`,
    [near.map(n => n.receiptno)]);

  return row?.at ? String(row.at) : null;
}

/** The till it was rung on, if the audit trail happens to place the cashier. */
async function machineAt(conn, staff, at) {
  if (!staff || !at) return "";
  const rows = await timed(conn, `till for ${staff}`,
    `SELECT amachine, COUNT(*) AS n FROM systemaudit
      WHERE astaff = ? AND asection = 'Point Of Sale'
        AND adate BETWEEN DATE_SUB(?, INTERVAL 90 MINUTE) AND DATE_ADD(?, INTERVAL 90 MINUTE)
      GROUP BY amachine ORDER BY n DESC LIMIT 1`, [staff, at, at]);
  return rows.length ? String(rows[0].amachine) : "";
}

/** The items on the lost sale, so it can be recognised without the system. */
async function itemsOn(conn, receiptno) {
  const rows = await timed(conn, `items on ${receiptno}`,
    `SELECT description, qty, price, total FROM pos_details
      WHERE receiptno = ? ORDER BY posdid`, [receiptno]);
  return rows.map(r => ({
    item: String(r.description || "").trim(),
    qty: Number(r.qty), price: Number(r.price), total: Number(r.total),
  }));
}

/**
 * Put the missing headers back, as held sales.
 *
 * `posted = 0` on purpose: this does not resurrect anything as a completed
 * sale. It makes each one appear in the cashier's POS list again so a person
 * can look at it and either finish it or throw it away. Nothing is posted to
 * stock or to the ledger, and no money moves.
 *
 * `INSERT IGNORE` is deliberate — if a header has appeared since the scan (a
 * till finishing a sale mid-run), leave the till's row alone.
 */
async function rebuild(conn, orphans) {
  log("");
  log(`  rebuilding ${orphans.length} header(s) as held sales (posted = 0)`);

  let written = 0, skipped = 0;
  for (const o of orphans) {
    const at = o.at || null;
    if (!at) { skipped++; log(`    ${o.receiptno}: no time could be established — skipped`); continue; }

    const result = await timed(conn, `restore ${o.receiptno}`,
      `INSERT IGNORE INTO pos_header
         (receiptno, amount, paid, changee, tax, disc, staff, salesref,
          pos, location, arname, tyype, posted, trandate, posdate, details)
       VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, ?, '', 'Cash Sale', 0, ?, DATE(?), 'RECOVERED')`,
      [o.receiptno, o.total, o.vat, o.disc, o.staff, o.staff,
       o.machine || "", o.location, at, at]);

    if (result.affectedRows > 0) {
      written++;
      // A recovery is a change to the shop's records, so it goes in the same
      // place the application puts everything else it does.
      await timed(conn, `audit ${o.receiptno}`,
        `INSERT INTO systemaudit (details, operation, aref, amodule, asection, adate, astaff, amachine)
         VALUES (?, 'RESTORE', ?, 'ACCOUNTS', 'Point Of Sale', NOW(), 'SYSTEM', ?)`,
        [`Restored header for ${o.receiptno} (${o.nlines} lines, ${money(o.total)})`,
         o.receiptno.slice(0, 10), o.machine || "RECOVERY"]);
    } else {
      skipped++;
      log(`    ${o.receiptno}: a header exists now — left alone`);
    }
  }

  log(`  ${written} restored, ${skipped} skipped`);
  return { written, skipped };
}

async function run() {
  log(`=== sales with no header ${REBUILD ? "(REBUILD)" : "(read only)"} ===`);
  log(describeConfigSource(MYSQL_CONFIG));

  if (REBUILD && !CONFIRMED) {
    log("");
    log("  --rebuild writes to pos_header on the shop's database.");
    log("  Re-run with --confirm once you are happy, and after close of business.");
    log("");
  }

  const conn = mysql.createConnection(toDriverOptions(MYSQL_CONFIG));
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));

  const byInitial = await cashiersByInitial(conn);
  const found = await findOrphans(conn);

  // Narrowing happens here, before the per-sale lookups, so a targeted run
  // costs a handful of queries rather than four per orphan in the window.
  const orphans = ONLY.length
    ? found.filter(o => ONLY.some(r => key(r) === key(o.receiptno)))
    : found;

  // A named receipt that the scan did not turn up is worth saying out loud: it
  // means either the window was too small or it is not actually headerless.
  if (ONLY.length) {
    const missing = ONLY.filter(r => !found.some(o => key(o.receiptno) === key(r)));
    log("");
    log(`  scan found ${found.length}; --receipt narrows this run to ${orphans.length}`);
    if (missing.length) {
      log(`  not found in this window (widen --rows, or it already has a header): ${missing.join(", ")}`);
    }
  }

  // Filtered runs write their own file so a targeted restore cannot overwrite
  // the full census the unfiltered scan produced.
  const outName = ONLY.length ? "orphan_sales_selected" : "orphan_sales";

  if (!orphans.length) {
    log("");
    log("  No sale lines without a header. Nothing was lost in this window.");
    emit(outName, []);
    conn.end();
    return;
  }

  log("");
  log(`  ${orphans.length} sale(s) exist as lines only, worth ${money(orphans.reduce((s, o) => s + o.total, 0))}`);
  log("");

  for (const o of orphans) {
    const who = attribute(o.receiptno, byInitial);
    o.staff = who.staff;
    o.ambiguous = who.ambiguous;
    o.at = await bracketTime(conn, o);
    o.machine = await machineAt(conn, o.staff, o.at);
    o.items = await itemsOn(conn, o.receiptno);

    log(`    ${o.receiptno.padEnd(12)} ${String(o.staff).padEnd(12)} ` +
        `${String(o.nlines).padStart(3)} lines  ${money(o.total).padStart(10)}  ` +
        `${o.at || "time unknown"}  ${o.machine}`);
    if (o.ambiguous) {
      log(`        (initial "${o.receiptno[0]}" is shared by ${o.ambiguous.join(", ")} — confirm before acting)`);
    }
  }

  emit(outName, orphans.map(o => ({
    receiptno: o.receiptno, staff: o.staff, sharedInitialWith: o.ambiguous,
    till: o.machine, lines: o.nlines, value: Math.round(o.total),
    vat: Math.round(o.vat), discount: Math.round(o.disc),
    approxTime: o.at, location: o.location, items: o.items,
  })));

  log("");
  log(`  written to ${path.join(OUT_DIR, `${outName}.json`)}`);

  if (REBUILD && CONFIRMED) {
    await rebuild(conn, orphans);
  } else if (REBUILD) {
    log("  nothing written — add --confirm to actually restore these");
  }

  conn.end();
  log(`=== done ${REBUILD && CONFIRMED ? "" : "— nothing was modified"} ===`);
}

run().catch(err => { log("Stopped: " + err.message); process.exit(1); });
