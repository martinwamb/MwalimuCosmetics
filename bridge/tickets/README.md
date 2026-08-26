# Collection tickets

A customer orders, the receipt goes to the picker, and until now the customer
stood at the counter holding nothing — no number, no idea whether the wait was
five minutes or two hours, no way of knowing their goods were ready except by
hovering.

This is the small slip that fills that gap, and the machinery behind it.

```
       till                          database                    laptop
  ─────────────                  ────────────────            ──────────────
  sale is paid
  receipt prints  ──────────▶    tickets row (OPEN)
  slip prints
       │                              │
  customer scans QR ─────────────────────────────────────▶  announcer links
                                      │                     their chat
  picker presses Ready ─────────▶ state = READY
                                      │
                                      └────────────────▶   speaks the number
                                                            sends Telegram
```

The till only ever writes one column. Everything the customer experiences hangs
off that, driven from the laptop — because nine of the eleven tills have no
internet and none of them are wired to the speakers.

## The three bands

| Band | When | Printed wait |
|---|---|---|
| `E` express | at most 2,000/- **and** at most 5 items | 5–10 min |
| `B` standard | up to 10,000/- | 20–30 min |
| `C` large order | above 10,000/- | 1–2 hours |

Both conditions must hold for express. A basket can be cheap and still be
twenty things to walk and fetch, and promising that customer five minutes is how
a queue stops being believed.

"Items" counts **distinct products** by default, not pieces — picking time
follows how many places on the shelf somebody has to visit. Change
`ticket.express.count_mode` to `UNITS` to count pieces instead.

Every threshold lives in `mw_settings` and can be changed without a rebuild.

## Files

| File | What it is |
|---|---|
| `../create-ticket-tables.js` | creates `tickets`, `ticket_counters`, `mw_settings` and seeds the thresholds |
| `../seed-ticket-rights.js` | registers the board in `sys_forms` and grants it to till users |
| `make-qr.js` | generates the QR pool, once |
| `announcer.js` | the laptop service: speaks numbers, sends Telegram, links scans |
| `run-announcer.ps1` | keeps the announcer up, with backoff |
| `prepare-testdb.js` | tops up `mwalimuinvest_test` so this can be tested on it |
| `copy-receipt.js` | copies a real posted sale into the test database |
| `TicketHarness.cs` | the C# test harness (see Testing below) |

In FumasV5: `TicketSlip.cs` (issue + draw the slip), `FTickets.cs` (the board),
`MwSettings.cs` (thresholds). `FChangePaymentOptM.cs` gains eleven lines.

## Setting it up

Everything is dry-run by default. Run without `--apply` first and read what it
intends to do.

**1. Tables.**

```
set MWALIMU_DB_NAME=mwalimuinvest
node ..\create-ticket-tables.js            # read this
node ..\create-ticket-tables.js --apply
```

**2. The screen.**

```
node ..\seed-ticket-rights.js --apply
```

Grants view + mark-ready to everyone who already holds view on `FPosList` (32
people here). Cancelling a ticket is granted to nobody — hand it out in the
Users screen to whoever supervises the floor.

**3. A Telegram bot.** Message [@BotFather](https://t.me/BotFather), send
`/newbot`, and keep the token. Then, on the laptop only:

```
C:\MwalimuSync\ticket-config.json
{ "botToken": "123456:ABC-DEF...", "voice": "" }
```

That file is machine-local and is never committed. `voice` can name a installed
voice (`Microsoft Zira Desktop`); blank uses the system default.

**4. The QR pool.** The bot name is baked into every image, so this runs after
step 3 and again if the bot is ever renamed.

```
node make-qr.js --bot YourBotName
robocopy qr "C:\futuresoft\Debugv5\Tickets\qr" /MIR
```

Then tell the slip the bot exists:

```sql
update mw_settings set svalue='YourBotName' where skey='ticket.bot';
```

With `ticket.bot` blank, slips print with no QR and everything else still works
— which is the sensible way to start.

**5. The announcer.**

```
.\run-announcer.ps1 -Database mwalimuinvest
```

Watch it for a few minutes, then install it as a logon task (the command is in
the header of that script).

## Testing

The whole thing runs against `mwalimuinvest_test` without touching live data.
`FumasV5.exe.config` holds the database name, so **a copy of the install folder
with `Database=mwalimuinvest_test;` runs the real application against the test
database** — real Crystal receipt and all.

```
set MWALIMU_DB_NAME=mwalimuinvest_test
node prepare-testdb.js --apply                        # pu, si, sq, staff, rights, get_smallest_qty
node ..\create-ticket-tables.js --apply
node ..\seed-ticket-rights.js --apply
node copy-receipt.js NPOS276317 JPOS276318 --apply    # real sales, all three bands
```

Then the C# harness. It reaches into the internal classes by reflection and has
to be compiled **into `bin\Release`** so `MySql.Data.dll` resolves:

```
copy TicketHarness.cs <FumasV5>\FumasV5\bin\Release\
cd <FumasV5>\FumasV5\bin\Release
C:\Windows\Microsoft.NET\Framework\v3.5\csc.exe -nologo -target:exe -out:TicketHarness.exe ^
  -r:System.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll -r:MySql.Data.dll -r:FumasV5.exe ^
  TicketHarness.cs
TicketHarness.exe mwalimuinvest_test .
```

It checks the banding edges, issues against the real receipts, renders each slip
to a PNG you can look at, prints one through a real driver to PDF, and checks
that one sale can never get two numbers. Delete the harness from `bin\Release`
when finished.

Speakers on their own:

```
node announcer.js --say E-042
```

## Things worth knowing

**The database server's clock is 24 minutes ahead of the laptop.** Every
timestamp on a ticket therefore comes from the server — the slip's printed time,
`created`, and the board's waiting column, which is computed with
`timestampdiff` on the server rather than by subtracting from the till's clock.
Done the naive way, a fresh ticket showed as having waited *minus* twenty-four
minutes and nothing ever went amber. Worth fixing the clocks regardless.

**Ticket numbers are allocated by the database, not by the till.** Eleven tills
issue at once. `ticket_counters` is bumped inside a transaction against a row
that is created first by a plain `insert ignore` — because `select ... for
update` on a row that does *not* exist takes a gap lock, several tills can hold
the same gap, and they then deadlock inserting into it. That is measured, not
theorised: eight connections racing to open the day's first band deadlocked
every time. With the row pre-created, the same eight allocated forty numbers
contiguously.

**Issuing is idempotent** on `receiptno`, enforced by a unique key. A reprint or
a double-press finds the existing ticket rather than minting a second number for
one sale and leaving a customer holding one nobody will ever call.

**A ticket failure can never cost a sale.** `IssueAndPrint` is called after the
money is taken and the receipt has printed, and it swallows everything to
`Tickets\ticket-errors.log`. A missing slip is a nuisance; a till that will not
finish a sale in front of a queue is not.

**The QR carries no date.** `?start=E042` means "today's E-042". A slip scanned
tomorrow morning would otherwise attach to a different customer, so the
announcer only links a scan to a ticket that is still open today and says so
plainly when it cannot.

---

# Product of the day, and the alerts

Set up alongside the tickets, sharing `mw_settings`:

```
node ..\create-competition-tables.js --apply
node ..\seed-ticket-rights.js --apply     # also registers the Admin Panel
node ..\create-sale-limits.js --apply
node ..\seed-sale-limit-rights.js --apply
```

One product is chosen each trading day — Mon/Wed/Fri a fast mover, Tue/Thu/Sat
something in stock that has barely sold in two months. A point per piece sold,
counted from the sale lines rather than stored, so a voided sale corrects
itself. The standing is on the dashboard for everyone; it carries no shillings,
so nothing there needs the money right.

**Who gets the points.** Only 1 receipt in 4,342 names a salesperson here, so
points fall through to the till login — which is the person who served the
customer, so the board is right. It cannot separate two people sharing one
till. Filling in the salesperson field at the POS is what would.

**Three toasts, one timer.** `GrnNotifier` (goods received) was already driven
from `Fmain.Timer1`, a five-minute timer that shipped enabled with an empty
handler. `ScoreNotifier` and `StockNotifier` join it: same timer, same
never-throws contract, each with its own watermark file under
`%LOCALAPPDATA%\FumasV5\` so one cannot disturb another. Each seeds itself
quietly on first run rather than greeting a new PC with a backlog.

Stock adjustments are watched on `adjust.aid`. An adjustment is the one stock
movement with no supplier, no invoice and no delivery behind it — until now the
only way to know one had happened was to go looking.

**The Admin Panel** (`FAdminPanel`, under Administrative Tools) holds the
thresholds, the weekday pattern, a by-hand choice of today's product, and the
sale limits. Everything reads and writes `mw_settings`, never `nauto` — the
vendor's settings screens rewrite that row wholesale, so a value added there is
a value one of their Save buttons can clear.

## Telegram: one bot, two uses

The bot `@mwalimucosmetics_bot` already has a **live webhook** serving the
website's order notifications (`apps/back/src/routes/orders.ts`). A bot can have
a webhook or long polling, never both, so `announcer.js` cannot call
`getUpdates` without breaking that.

Outbound is unaffected — `sendMessage` works alongside a webhook — so the
"goods are ready" message needs nothing. Only the inbound QR scan does. Either:

- **a second bot** for tickets, and the announcer long-polls it as written; or
- **route it through the server**: extend the existing webhook to record
  `/start E042`, and have the announcer fetch pending links.

Until one is in place, the QR is printed and scannable but nothing links the
chat, and tickets are announced over the speakers only.
