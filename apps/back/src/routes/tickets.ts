import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

const SYNC_SECRET = process.env.SYNC_SECRET ?? "mwalimu-sync-secret";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

/**
 * Collection tickets — the half of the flow that has to live on the internet.
 *
 * A customer waiting for their goods scans the QR on their slip. That opens
 * Telegram and sends "/start E042" on their behalf, which is the only way a bot
 * can ever message them: it cannot message a phone number, only reply to
 * somebody who has messaged it first.
 *
 * That update has to arrive somewhere reachable from the internet, and it
 * cannot be the shop. Nine of the eleven tills have no internet at all, the
 * laptop is behind NAT, and the shop's MySQL is on the far side of the shop
 * LAN. It also cannot be a second bot polling for updates: @mwalimucosmetics_bot
 * already has a live webhook serving the website's order notifications, and a
 * bot can have a webhook or long polling but never both.
 *
 * So the scan lands here, at the webhook that already exists, and is parked in
 * TicketLink. The laptop announcer — which can see the shop's MySQL — collects
 * it, attaches the chat to the ticket, and does the messaging from there.
 *
 *     customer scans ──▶ Telegram ──▶ this webhook ──▶ TicketLink
 *                                                          │
 *                            laptop announcer ◀────────────┘  (polls, claims)
 *                                     │
 *                                     └──▶ shop MySQL: tickets.tg_chat_id
 */

// The payload the deep link carries: band letter then the sequence, no dash,
// because Telegram's start parameter allows only letters, digits, _ and -.
const START_PAYLOAD = /^\/start\s+([EBC])(\d{1,4})\s*$/i;

function requireSyncSecret(req: any, res: any, next: any) {
  if (req.headers["x-sync-secret"] !== SYNC_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function replyToChat(chatId: string | number, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (err: any) {
    console.error("[tickets] reply failed", err?.message ?? err);
  }
}

/**
 * Handles a Telegram `message` update if it is a ticket deep link.
 *
 * Returns true when it was one, so the caller knows to stop looking. Called
 * from the orders webhook rather than having a webhook of its own, because
 * Telegram allows exactly one per bot.
 *
 * The acknowledgement is sent from here rather than left to the announcer. The
 * customer is standing at a counter with a phone in their hand, and a reply
 * that waits on a laptop three seconds away — or on a laptop that is switched
 * off — is a reply they will assume never came. The announcer follows up only
 * when it has something to correct.
 */
export async function handleTicketStart(update: any): Promise<boolean> {
  const message = update?.message;
  const text: string | undefined = message?.text;
  const chatId = message?.chat?.id;
  if (!text || chatId === undefined || chatId === null) return false;

  const match = START_PAYLOAD.exec(text.trim());
  if (!match) {
    // A bare /start is somebody who found the bot without a ticket. Worth
    // answering, but it is not a link and nothing is recorded.
    if (/^\/start\s*$/i.test(text.trim())) {
      await replyToChat(chatId,
        "Hello. Scan the QR code on your collection ticket and I will message you " +
        "the moment your goods are ready.");
      return true;
    }
    return false;
  }

  const ticketCode = `${match[1].toUpperCase()}-${match[2].padStart(3, "0")}`;

  try {
    await prisma.ticketLink.create({
      data: {
        ticketCode,
        chatId: String(chatId),
        firstName: message?.chat?.first_name ?? null
      }
    });
  } catch (err: any) {
    console.error("[tickets] could not record link", err?.message ?? err);
    // Still acknowledge. A customer who scanned correctly should not be told
    // off for a fault at this end.
  }

  const who = message?.chat?.first_name ? `Thank you ${message.chat.first_name}.\n\n` : "";
  await replyToChat(chatId,
    `${who}Ticket ${ticketCode} registered.\n` +
    "I will message you the moment your goods are ready.\n\n" +
    "Mwalimu Cosmetics");

  return true;
}

/**
 * The announcer collecting scans it has not yet applied.
 *
 * Nothing is deleted here. The rows are marked claimed in a separate call, so a
 * laptop that dies between fetching and applying re-reads the same links on its
 * next pass rather than losing a customer's registration.
 */
router.get("/links", requireSyncSecret, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const links = await prisma.ticketLink.findMany({
      where: { claimedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit
    });
    res.json({ data: links });
  } catch (err: any) {
    console.error("[tickets] links failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to read ticket links" });
  }
});

router.post("/links/claim", requireSyncSecret, async (req, res) => {
  try {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      res.json({ data: { claimed: 0 } });
      return;
    }
    const result = await prisma.ticketLink.updateMany({
      where: { id: { in: ids }, claimedAt: null },
      data: { claimedAt: new Date() }
    });
    res.json({ data: { claimed: result.count } });
  } catch (err: any) {
    console.error("[tickets] claim failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to claim ticket links" });
  }
});

/**
 * The announcer asking for a message to be delivered.
 *
 * The laptop can reach api.telegram.org perfectly well and sends the
 * goods-are-ready message itself. This exists for the case where it cannot —
 * a shop WiFi that resolves the server but not Telegram, which has happened
 * here before — so there is a second route to the customer that does not
 * involve anybody walking to the counter.
 */
router.post("/notify", requireSyncSecret, async (req, res) => {
  try {
    const chatId = req.body?.chatId;
    const text = req.body?.text;
    if (!chatId || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "chatId and text are required" });
      return;
    }
    if (!TELEGRAM_BOT_TOKEN) {
      res.status(503).json({ error: "No bot token on this server" });
      return;
    }
    await replyToChat(chatId, text);
    res.json({ data: { sent: true } });
  } catch (err: any) {
    console.error("[tickets] notify failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to send" });
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * The board, and the receipt page
 *
 * Everything above is about Telegram. What follows is the other half: seeing
 * the queue from outside the shop, marking a ticket collected from there, and
 * letting a customer open their own receipt.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The shop pushing its day.
 *
 * Sent by bridge/pusher.js on its normal 30-second cycle rather than through
 * the nightly mirror, because a board showing who is still waiting is worthless
 * a day late, and a customer scanning the QR on their slip expects the receipt
 * to be there within the minute.
 *
 * Upsert on (ticketDay, ticketCode): the same ticket is pushed on every cycle
 * as its state changes, so this runs many times per ticket and has to converge
 * rather than accumulate.
 */
router.post("/sync", requireSyncSecret, async (req, res) => {
  try {
    const rows: any[] = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
    if (!rows.length) {
      res.json({ data: { written: 0 } });
      return;
    }

    let written = 0;
    for (const r of rows) {
      if (!r?.ticketDay || !r?.ticketCode || !r?.receiptno) continue;

      const day = new Date(r.ticketDay);
      if (Number.isNaN(day.getTime())) continue;

      const data = {
        ticketDay: day,
        ticketCode: String(r.ticketCode),
        band: String(r.band ?? "B").slice(0, 1),
        seq: Number(r.seq ?? 0),
        receiptno: String(r.receiptno),
        arname: r.arname ? String(r.arname) : null,
        amount: r.amount ?? 0,
        lineCount: Number(r.lineCount ?? 0),
        etaLo: Number(r.etaLo ?? 0),
        etaHi: Number(r.etaHi ?? 0),
        state: String(r.state ?? "OPEN"),
        issuedAt: r.issuedAt ? new Date(r.issuedAt) : new Date(),
        till: r.till ? String(r.till) : null,
        staff: r.staff ? String(r.staff) : null,
        readyAt: r.readyAt ? new Date(r.readyAt) : null,
        readyBy: r.readyBy ? String(r.readyBy) : null,
        collectedAt: r.collectedAt ? new Date(r.collectedAt) : null,
        collectedBy: r.collectedBy ? String(r.collectedBy) : null,
        receiptToken: r.receiptToken ? String(r.receiptToken) : null,
        items: r.items ?? undefined
      };

      await prisma.ticket.upsert({
        where: {
          ticketDay_ticketCode: { ticketDay: data.ticketDay, ticketCode: data.ticketCode }
        },
        create: data,
        update: data
      });
      written++;
    }

    res.json({ data: { written } });
  } catch (err: any) {
    console.error("[tickets] sync failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to store tickets" });
  }
});

/**
 * The board itself.
 *
 * SALES sits alongside ADMIN and ACCOUNTS because the people who would mark a
 * ticket collected are the ones on the counter, not the ones in the office.
 */
router.get("/board", requireRoles(["ADMIN", "ACCOUNTS", "SALES"]), async (req, res) => {
  try {
    const raw = req.query.day ? new Date(String(req.query.day)) : new Date();
    if (Number.isNaN(raw.getTime())) {
      res.status(400).json({ error: "Bad day" });
      return;
    }
    // The column is a DATE. Anchored in UTC because that is how Prisma stores
    // a @db.Date, and building it from local parts would land on the previous
    // day for anyone east of Greenwich - which is everybody here.
    const day = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));

    const tickets = await prisma.ticket.findMany({
      where: { ticketDay: day },
      orderBy: [{ band: "asc" }, { seq: "asc" }],
      select: {
        ticketDay: true, ticketCode: true, band: true, seq: true,
        receiptno: true, arname: true, amount: true, lineCount: true,
        etaLo: true, etaHi: true, state: true, issuedAt: true,
        till: true, staff: true, readyAt: true, collectedAt: true
        // receiptToken is deliberately NOT selected. Staff have no need of it,
        // and it is the one field that would let anybody open any receipt.
      }
    });

    res.json({ data: tickets });
  } catch (err: any) {
    console.error("[tickets] board failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to read the board" });
  }
});

/**
 * Marking a ticket collected, from the web.
 *
 * This server cannot reach the shop's MySQL - it is on the far side of the shop
 * LAN - so this does not write the ticket. It queues a PendingChange, the same
 * proven channel the Stock page uses, and bridge/pusher.js applies it on its
 * next cycle.
 *
 * The local copy moves to COLLECTED at once so the board reflects the press.
 * The shop stays the authority: the very next push overwrites this row with
 * whatever MySQL actually says, so a failed write-back shows the ticket waiting
 * again rather than quietly claiming a customer has their goods.
 */
router.post("/collect", requireRoles(["ADMIN", "ACCOUNTS", "SALES"]), async (req: any, res) => {
  try {
    const ticketDay = req.body?.ticketDay;
    const ticketCode = req.body?.ticketCode;
    if (!ticketDay || !ticketCode) {
      res.status(400).json({ error: "ticketDay and ticketCode are required" });
      return;
    }

    const raw = new Date(ticketDay);
    if (Number.isNaN(raw.getTime())) {
      res.status(400).json({ error: "Bad ticketDay" });
      return;
    }
    const day = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
    const code = String(ticketCode);

    const ticket = await prisma.ticket.findUnique({
      where: { ticketDay_ticketCode: { ticketDay: day, ticketCode: code } }
    });
    if (!ticket) {
      res.status(404).json({ error: "No such ticket" });
      return;
    }
    if (ticket.state === "COLLECTED") {
      res.json({ data: { queued: false, already: true } });
      return;
    }

    const who = req.user?.email ?? req.user?.name ?? "WEB";

    await prisma.pendingChange.create({
      data: {
        type: "ticket_collected",
        payload: {
          ticketDay: day.toISOString().slice(0, 10),
          ticketCode: code,
          by: who
        }
      }
    });

    await prisma.ticket.update({
      where: { ticketDay_ticketCode: { ticketDay: day, ticketCode: code } },
      data: { state: "COLLECTED", collectedAt: new Date(), collectedBy: "WEB" }
    });

    res.json({ data: { queued: true } });
  } catch (err: any) {
    console.error("[tickets] collect failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to queue collection" });
  }
});

/**
 * A customer opening their own receipt - PUBLIC, no login.
 *
 * Somebody just handed a paper receipt is not going to make an account to see
 * it again, so there is nothing to sign in to. The token does the work: 22
 * characters of a 57-character alphabet, about 128 bits, from
 * RNGCryptoServiceProvider on the till. Receipt NUMBERS run in a visible
 * sequence and are useless as a key - anyone holding one slip could read the
 * receipt of the customer served before them.
 *
 * An unknown token, a malformed one and one of the wrong length all get the
 * same 404. Answering differently would confirm to somebody guessing that they
 * had the shape right.
 *
 * Only what is already printed on the paper is returned. Not the till, not the
 * ticket's state, not anybody else's anything.
 */
router.get("/receipt/:token", async (req, res) => {
  try {
    const token = String(req.params.token ?? "");

    if (!/^[0-9A-Za-z]{22}$/.test(token)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { receiptToken: token },
      select: {
        receiptno: true, arname: true, amount: true, lineCount: true,
        issuedAt: true, ticketCode: true, staff: true, items: true
      }
    });

    if (!ticket) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({
      data: {
        receiptno: ticket.receiptno,
        customer: ticket.arname,
        servedBy: ticket.staff,
        ticketCode: ticket.ticketCode,
        soldAt: ticket.issuedAt,
        total: ticket.amount,
        lineCount: ticket.lineCount,
        items: ticket.items ?? []
      }
    });
  } catch (err: any) {
    console.error("[tickets] receipt failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to read receipt" });
  }
});
