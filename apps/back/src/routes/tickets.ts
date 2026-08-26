import { Router } from "express";
import { prisma } from "../lib/prisma.js";

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
