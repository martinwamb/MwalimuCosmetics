/**
 * Mwalimu Cosmetics — the collection ticket tables.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 *
 * The shop sells across a counter. A customer orders, the receipt is printed
 * and carried to the shelves by a picker, the goods are gathered and checked,
 * and only then is the customer called and handed both goods and receipt.
 * Between ordering and collection the customer holds nothing at all: no
 * number, no idea whether the wait is five minutes or two hours, and no way
 * of knowing their goods are ready except by standing near the counter.
 *
 * A ticket is the small slip that fills that gap. It prints beside the main
 * receipt, is handed over immediately, and carries a short number the shop
 * can call out.
 *
 * ── Why new tables rather than columns on pos_header ──────────────────
 *
 * pos_header is written by the vendor's own POS, by the returns path and by
 * the draft/park path. Adding columns there makes every one of those writers
 * a writer of this feature too. These tables have exactly two writers:
 * FumasV5's TicketSlip/FTickets, and the laptop announcer service.
 *
 * ── Why the sequence lives in the database ────────────────────────────
 *
 * Eleven tills issue tickets at once. A number picked in C# — even
 * "select max(seq)+1" — hands the same number to two customers the first busy
 * morning. ticket_counters is bumped in three steps instead:
 *
 *   INSERT IGNORE INTO ticket_counters VALUES (day, band, 0);   -- no transaction
 *   START TRANSACTION;
 *   SELECT next_seq ... FOR UPDATE;   UPDATE next_seq = next_seq + 1;
 *   COMMIT;
 *
 * The INSERT IGNORE is not decoration and must stay outside the transaction.
 * SELECT ... FOR UPDATE against a row that does not exist yet takes a GAP
 * lock rather than a row lock, and several tills can hold the same gap at
 * once — so when they all then insert into it, InnoDB deadlocks. Measured,
 * not theorised: eight connections racing to open the day's first band
 * deadlocked every time. Creating the row first with a plain insert, which
 * takes no gap lock, leaves nothing to contend over. Retested at eight
 * connections x five tickets: contiguous 1..40, no duplicates, no deadlock.
 *
 * LAST_INSERT_ID(next_seq + 1) is the more usual trick and was tried first.
 * It works, but it is connection-scoped session state, so it silently
 * requires that nothing else uses the connection between the UPDATE and the
 * SELECT that reads it back. An explicit row lock has no such standing
 * requirement on its caller.
 *
 * ── Why receiptno is unique ───────────────────────────────────────────
 *
 * Issuing has to be idempotent. A reprint, a retried post, or a cashier
 * pressing pay twice must find the ticket that already exists rather than
 * mint a second number for one sale and leave a customer holding a number
 * nobody will ever call.
 *
 * Dry run by default. Pass --apply to write.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");

// receiptno is varchar(20) on pos_header and pos_details. Matching it exactly
// keeps the join to the sale on the same type, which on MySQL 5.1 is the
// difference between an index seek and a scan.
const DDL = {
  tickets: `
CREATE TABLE IF NOT EXISTS tickets (
  ticket_day   date          NOT NULL,
  ticket_code  varchar(12)   NOT NULL,
  band         char(1)       NOT NULL,
  seq          int(11)       NOT NULL,
  receiptno    varchar(20)   NOT NULL,
  arcode       varchar(30)       NULL,
  arname       varchar(100)      NULL,
  amount       decimal(20,2) NOT NULL DEFAULT 0,
  line_count   int(11)       NOT NULL DEFAULT 0,
  units        decimal(20,2) NOT NULL DEFAULT 0,
  eta_lo       int(11)       NOT NULL DEFAULT 0,
  eta_hi       int(11)       NOT NULL DEFAULT 0,
  state        varchar(12)   NOT NULL DEFAULT 'OPEN',
  created      datetime          NULL,
  till         varchar(64)       NULL,
  staff        varchar(50)       NULL,
  ready_at     datetime          NULL,
  ready_by     varchar(50)       NULL,
  collected_at datetime          NULL,
  collected_by varchar(50)       NULL,
  tg_chat_id   bigint(20)        NULL,
  tg_linked_at datetime          NULL,
  notified_at  datetime          NULL,
  announced_at datetime          NULL,
  receipt_token varchar(32)      NULL,
  PRIMARY KEY (ticket_day, ticket_code),
  UNIQUE KEY uq_ticket_receipt (receiptno),
  UNIQUE KEY uq_ticket_token (receipt_token),
  KEY ix_ticket_state (ticket_day, state)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`,

  ticket_counters: `
CREATE TABLE IF NOT EXISTS ticket_counters (
  ticket_day date    NOT NULL,
  band       char(1) NOT NULL,
  next_seq   int(11) NOT NULL,
  PRIMARY KEY (ticket_day, band)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`,

  mw_settings: `
CREATE TABLE IF NOT EXISTS mw_settings (
  skey    varchar(64)  NOT NULL,
  svalue  varchar(255) NOT NULL,
  updated datetime         NULL,
  staff   varchar(50)      NULL,
  PRIMARY KEY (skey)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`
};

// Thresholds live here rather than in C# so the shop can change what "express"
// means without waiting for a build to reach eleven tills.
//
// count_mode decides what "no more than 5 items" counts. LINES counts distinct
// products on the receipt — five things to walk and fetch. UNITS counts pieces,
// so a dozen of one product is twelve. LINES is the default because picking
// time follows how many places on the shelf somebody has to visit.
const SETTINGS = [
  ["ticket.enabled", "1", "Master switch. 0 stops slips printing without a rebuild."],
  ["ticket.express.max_amount", "2000", "Express band upper value, KES."],
  ["ticket.express.max_items", "5", "Express band item ceiling."],
  ["ticket.express.count_mode", "LINES", "LINES = distinct products, UNITS = pieces."],
  ["ticket.standard.max_amount", "10000", "Standard band upper value. Above this is the large band."],
  // These three are now the FALLBACK, used until a band has enough completed
  // tickets to measure with. The printed wait normally comes from how fast the
  // band's team is actually finishing today, times the queue in front of you.
  ["ticket.eta.E", "5-10", "Express fallback wait, minutes, until there is history."],
  ["ticket.eta.B", "20-30", "Standard fallback wait, minutes, until there is history."],
  ["ticket.eta.C", "60-120", "Large fallback wait, minutes, until there is history."],

  ["ticket.eta.measured", "1",
    "Estimate the wait from measured throughput. 0 goes back to the fixed ranges above."],
  ["ticket.eta.days", "14",
    "How many trading days of completed tickets to measure pace from."],
  ["ticket.eta.min_samples", "20",
    "Fewer usable gaps than this in a band and the fixed range is printed instead."],
  ["ticket.eta.max_gap", "45",
    "Minutes. A longer gap between completions is lunch or a quiet spell, not " +
    "the team's pace, and is discarded."],
  ["ticket.bot", "", "Telegram bot username, no @. Blank prints no QR invitation."],

  // Off: every sale gets a ticket. The cashier's "no slip needed" checkbox is
  // not drawn at all while this is 0. A queue that is only partly numbered is
  // worse than one that is not numbered — the customers without a slip do not
  // know they are missing anything, and staff cannot tell who waits for what.
  ["ticket.allow_skip", "0",
    "1 shows the cashier a 'no collection ticket' box on the payment screen."],

  // Not ticketing, but this script owns mw_settings and a second script that
  // added two rows to a table it did not create would be worse.
  ["update.notify", "1",
    "Toast on a till when a build is waiting, asking for a restart. 0 silences it."],
  ["session.restore", "1",
    "Reopen the windows a cashier had open when the POS is restarted."],
  ["session.restore.forms", "FPOS",
    "Comma-separated form names eligible for restore. Deliberately short: most " +
    "of the 621 forms here were never written to be opened cold."],

  // Where the download-your-receipt QR points. The ticket's receipt_token is
  // appended. Kept as a setting because the domain is the one part of this
  // that could plausibly change without a rebuild.
  ["ticket.receipt.url", "https://mwalimucosmetics.com/r/",
    "Base for the receipt-download QR. The ticket's receipt_token is appended."],

  // Not ticketing, but this script owns mw_settings, and a second script that
  // only added two rows to a table it did not create would be worse.
  //
  // A per-machine override, theme.enabled.<COMPUTERNAME>, is checked first and
  // is not seeded: it exists only when somebody sets it for one awkward till.
  ["theme.enabled", "1", "Restyle every screen as it opens. 0 restores the old look."]
];

// --db lets this run against mwalimuinvest_test without exporting a whole set
// of credentials. MWALIMU_DB_NAME alone does not do it: the environment path
// is all-or-nothing, so setting just the name silently falls back to the
// legacy config and its hardcoded production database - which looks exactly
// like it worked.
const dbIndex = process.argv.indexOf("--db");
const dbName = dbIndex !== -1 && process.argv[dbIndex + 1] ? process.argv[dbIndex + 1] : null;

const cfg = getMysqlConfig(dbName ? { database: dbName } : undefined);
console.log(describeConfigSource(cfg));
console.log("Database: " + cfg.database);
console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 30000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

async function tableExists(name) {
  const rows = await q(
    "select table_name from information_schema.tables " +
    "where table_schema = database() and table_name = ?", [name]);
  return rows.length > 0;
}

async function columnExists(table, column) {
  const rows = await q(
    "select column_name from information_schema.columns " +
    "where table_schema = database() and table_name = ? and column_name = ?",
    [table, column]);
  return rows.length > 0;
}

async function indexExists(table, index) {
  const rows = await q(
    "select index_name from information_schema.statistics " +
    "where table_schema = database() and table_name = ? and index_name = ?",
    [table, index]);
  return rows.length > 0;
}

async function ensureColumn(table, column, definition, why) {
  if (!(await tableExists(table))) {
    console.log("  " + table + "." + column + " — table does not exist yet; the DDL above covers it.");
    return;
  }
  if (await columnExists(table, column)) {
    console.log("  " + table + "." + column + " already present — left alone.");
    return;
  }
  const sql = "ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition;
  console.log("  " + table + "." + column + " missing. " + why);
  console.log("    " + sql);
  if (APPLY) {
    await q(sql);
    console.log("    -> Added.");
  }
}

async function ensureIndex(table, index, definition, why) {
  if (!(await tableExists(table))) return;
  if (await indexExists(table, index)) {
    console.log("  " + table + "." + index + " already present — left alone.");
    return;
  }
  const sql = "ALTER TABLE " + table + " ADD " + definition.replace(
    /^UNIQUE/, "UNIQUE KEY " + index);
  console.log("  " + table + "." + index + " missing. " + why);
  console.log("    " + sql);
  if (APPLY) {
    await q(sql);
    console.log("    -> Added.");
  }
}

async function main() {
  for (const name of Object.keys(DDL)) {
    if (await tableExists(name)) {
      console.log(name + " already exists — left alone.");
    } else {
      console.log(name + " does not exist yet. It would be created as:");
      console.log(DDL[name].trim());
      if (APPLY) {
        await q(DDL[name]);
        console.log("  -> Created.");
      }
      console.log("");
    }
  }

  // ── Columns added after the table already existed ──────────────────
  //
  // CREATE TABLE IF NOT EXISTS does nothing at all to a table that is already
  // there, so a column added to the DDL above would reach a fresh install and
  // silently miss production - which is the only install that matters.
  //
  // Each entry is checked and added on its own. Deliberately not a single
  // ALTER of everything: MySQL 5.1 rebuilds the whole table for an ALTER, and
  // on a table this size that is a pause the shop would feel.
  console.log("\n-- columns on existing tables --");
  await ensureColumn("tickets", "receipt_token", "varchar(32) NULL",
    "The unguessable half of the receipt-download link.");
  await ensureIndex("tickets", "uq_ticket_token", "UNIQUE (receipt_token)",
    "Receipt numbers run in sequence; the token is what stops one customer " +
    "reading another's receipt, so it must be unique.");

  // Obsolete, but left in place rather than deleted: the QR pool it counted is
  // gone (QrCode.cs encodes in the exe now), and a stray row costs nothing
  // while a DELETE against a settings table nobody is watching costs trust.
  const dead = await q("select skey from mw_settings where skey = 'ticket.qr.max_seq'");
  if (dead.length) {
    console.log("  ticket.qr.max_seq is obsolete - the QR image pool it sized " +
      "no longer exists. Harmless; left alone.");
  }

  // Seeds are only ever inserted, never updated: once the shop has changed a
  // threshold on the admin panel, re-running this script must not quietly put
  // it back to whatever the developer thought it should be.
  console.log("\n-- settings --");
  const haveSettings = await tableExists("mw_settings");
  for (const [key, value, why] of SETTINGS) {
    if (!haveSettings) {
      console.log("  " + key + " = " + value + "   (would seed; " + why + ")");
      continue;
    }
    const present = await q("select svalue from mw_settings where skey = ?", [key]);
    if (present.length) {
      console.log("  " + key + " = " + present[0].svalue + "   (already set, left alone)");
    } else {
      console.log("  " + key + " = " + value + "   (seeding; " + why + ")");
      if (APPLY) {
        await q("insert into mw_settings (skey, svalue, updated, staff) values (?, ?, now(), 'setup')",
          [key, value]);
      }
    }
  }

  // A ticket counts what the customer is carrying away, and a carton is not
  // one piece. Without get_smallest_qty the units column would add cartons to
  // pieces, and the express test would be wrong on exactly the baskets where
  // it matters.
  const fn = await q(
    "select routine_name from information_schema.routines " +
    "where routine_schema = database() and routine_name = 'get_smallest_qty'");
  console.log(fn.length
    ? "\nget_smallest_qty: present — piece counts will be correct."
    : "\nget_smallest_qty: MISSING. Unit counts would add cartons to pieces. " +
      "Leave ticket.express.count_mode=LINES here, or install the function.");

  if (await tableExists("tickets")) {
    const t = await q("select count(*) n from tickets");
    console.log("\ntickets holds " + t[0].n + " row(s).");
  }
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
