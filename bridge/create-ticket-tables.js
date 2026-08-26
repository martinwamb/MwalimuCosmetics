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
  PRIMARY KEY (ticket_day, ticket_code),
  UNIQUE KEY uq_ticket_receipt (receiptno),
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
  ["ticket.eta.E", "5-10", "Express wait shown on the slip, minutes."],
  ["ticket.eta.B", "20-30", "Standard wait shown on the slip, minutes."],
  ["ticket.eta.C", "60-120", "Large wait shown on the slip, minutes."],
  ["ticket.bot", "", "Telegram bot username, no @. Blank prints no QR invitation."],
  ["ticket.qr.max_seq", "300", "How many QR images exist per band. Past this the link prints as text."]
];

const cfg = getMysqlConfig();
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
