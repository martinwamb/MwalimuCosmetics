/**
 * Mwalimu Cosmetics — build pos_header(arcode, trandate) overnight, by itself.
 *
 * ── What needs doing, and why it cannot just be done ──────────────────
 *
 * FSellerActivity asks whether a phone number had ever bought here before
 * today. pos_idx leads on receiptno, so without an index on arcode that costs
 * about 111,000 row reads for every row of output, and the screen leaves the
 * "new buyers" column out until the index exists.
 *
 * Adding it is not free. This MySQL is 5.1 with the built-in InnoDB and no
 * plugin, so ALTER TABLE ADD INDEX rewrites the whole table and holds it while
 * it does. Measured by timing the same statement on a 50,000-row copy and
 * scaling: about 43 seconds for the live table. For those 43 seconds no till
 * can write a sale — they would queue, and innodb_lock_wait_timeout is 50
 * seconds, which is close enough to be somebody's failed sale.
 *
 * So it has to happen when the shop is not trading. Over the last twelve
 * trading days the first sale was between 07:33 and 08:45 and the last between
 * 20:21 and 22:38, all on the server's clock.
 *
 * ── Why the database schedules it, and not this laptop ────────────────
 *
 * Nothing here is reliably awake at that hour. SERVER-PC refuses C$ and has no
 * remote PowerShell, so no task can be installed on it; the tills are switched
 * off; and this laptop leaves the building. MySQL's own event scheduler has
 * none of those problems: the one machine that must be running for the work to
 * matter is the one that runs it.
 *
 * The event checks two things before it touches anything — that no sale has
 * been recorded in the last twenty minutes, and that the index is not already
 * there — so a late night simply means it does nothing and tries again
 * tomorrow. It repeats nightly for a week and then removes itself, and writes
 * mw_settings salelimit.index.built when it succeeds so there is proof.
 *
 * ── Why this script exists as well ────────────────────────────────────
 *
 * event_scheduler is a global that does NOT survive a restart, and this server
 * restarted at 03:53 on the morning this was written. So this runs on the
 * laptop every half hour, arms the scheduler if a restart disarmed it, and puts
 * the event back if it went with it. Once the index exists it removes the event,
 * removes its own scheduled task and stops.
 *
 * Everything is expressed in the SERVER's clock — the schedule, the idle check
 * and the trading hours above. The server runs about 24 minutes ahead of this
 * laptop, and converting between them is how you end up building an index at
 * ten past eight in the morning.
 *
 * Dry run by default. Pass --apply to write. The scheduled task passes it.
 */

const { execFileSync } = require("child_process");
const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./db-config.js");

const APPLY = process.argv.includes("--apply");
const QUIET = process.argv.includes("--quiet");

const EVENT = "mw_build_arcode_index";
const TASK = "MwalimuArcodeIndex";
const MARKER = "salelimit.index.built";

// Server clock. Latest sale seen in twelve days was 22:38, earliest 07:33.
const HOUR = 23;
const MINUTE = 45;
const IDLE_MINUTES = 20;
const GIVE_UP_AFTER_DAYS = 7;

const say = (...a) => { if (!QUIET) console.log(...a); };

const cfg = getMysqlConfig();
say(describeConfigSource(cfg));
say(APPLY ? "MODE: APPLY (writing)\n" : "MODE: dry run (pass --apply to write)\n");

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) =>
    conn.query({ sql, timeout: 120000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

// The body runs inside the database, so every time in it is the server's own.
const EVENT_BODY = `
begin
  declare recent int default 0;
  declare already int default 0;

  select count(*) into recent from pos_header
    where trandate >= now() - interval ${IDLE_MINUTES} minute;

  select count(*) into already from information_schema.statistics
    where table_schema = database() and table_name = 'pos_header'
      and index_name = 'pos_idx_arcode';

  if recent = 0 and already = 0 then
    alter table pos_header add index pos_idx_arcode (arcode, trandate);
    replace into mw_settings (skey, svalue, staff, updated)
      values ('${MARKER}', date_format(now(), '%Y-%m-%d %H:%i'), 'event', now());
  end if;
end`;

// Removing the task from inside the task it is running in is allowed, and is
// the only way this tidies up without somebody remembering to.
function removeTask() {
  try {
    execFileSync("schtasks", ["/Delete", "/TN", TASK, "/F"], { stdio: "ignore" });
    say(`Scheduled task ${TASK}: removed.`);
  } catch (e) {
    // Not installed, or not ours to remove. Neither is worth failing over.
  }
}

async function main() {
  const done = await q(
    "select count(*) n from information_schema.statistics where table_schema = database() " +
    "and table_name = 'pos_header' and index_name = 'pos_idx_arcode'");

  if (done[0].n > 0) {
    const built = await q("select svalue from mw_settings where skey = ?", [MARKER]);
    console.log("pos_idx_arcode is BUILT" +
      (built.length ? " — recorded at " + built[0].svalue + " (server clock)" : ""));
    say("Nothing left to schedule.");
    if (APPLY) {
      await q(`drop event if exists ${EVENT}`);
      removeTask();
    }
    return;
  }

  // A restart disarms the scheduler, and this server restarts.
  const sched = (await q("show variables like 'event_scheduler'")).map(r => r.Value)[0];
  say(`event_scheduler: ${sched}`);
  if (sched !== "ON") {
    say("  arming it — a disarmed scheduler is why a defined event does nothing.");
    if (APPLY) await q("set global event_scheduler = on");
  }

  const existing = await q(
    "select event_name, status, starts, ends from information_schema.events " +
    "where event_schema = database() and event_name = ?", [EVENT]);

  if (existing.length && existing[0].status === "ENABLED") {
    const t = await q("select now() srv_now");
    say(`Event ${EVENT}: already scheduled, next run ${existing[0].starts} (server clock).`);
    say(`Server clock now: ${t[0].srv_now}`);
    return;
  }

  say(`Event ${EVENT}: not scheduled. It would be created to run nightly at ` +
    `${HOUR}:${String(MINUTE).padStart(2, "0")} on the server's clock, ` +
    `skipping any night with a sale in the last ${IDLE_MINUTES} minutes, ` +
    `and giving up after ${GIVE_UP_AFTER_DAYS} days.`);

  if (!APPLY) return;

  // STARTS is worked out by the server, from the server's own clock. Doing the
  // arithmetic here and sending a timestamp is how the 24-minute skew between
  // these two machines gets baked into the schedule.
  await q(`drop event if exists ${EVENT}`);
  await q(
    `create event ${EVENT} on schedule every 1 day ` +
    `starts date(now()) + interval ${HOUR} hour + interval ${MINUTE} minute ` +
    `ends date(now()) + interval ${GIVE_UP_AFTER_DAYS} day + interval 23 hour + interval 59 minute ` +
    `on completion not preserve do ${EVENT_BODY}`);

  const now = await q(
    "select e.starts, e.ends, e.status, now() srv_now from information_schema.events e " +
    "where e.event_schema = database() and e.event_name = ?", [EVENT]);
  console.log("Scheduled:");
  console.table(now);
}

main()
  .catch(e => { console.error("FAILED:", e.message); process.exitCode = 1; })
  .then(() => conn.end());
