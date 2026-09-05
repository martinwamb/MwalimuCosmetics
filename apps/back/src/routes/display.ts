import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

/**
 * The customer-facing screen in the shop.
 *
 * A laptop drives a TV over HDMI, opens /display?key=… fullscreen, and is left
 * alone for weeks. Everything here follows from that:
 *
 *   * A KEY, not a login. Nobody is going to keep a session alive on an
 *     unattended machine, and a JWT that expires overnight is a blank screen
 *     in the morning. The key survives reboots and power cuts.
 *
 *   * TICKET CODES ONLY. This is a wall in a public shop. No customer names,
 *     no amounts, no receipt numbers — nothing that is anybody's business but
 *     the person holding the slip. That is not a setting; the query below
 *     simply does not select those columns.
 *
 *   * ONE request for everything. The screen polls a single endpoint every few
 *     seconds and re-renders. No websockets to reconnect, no second request to
 *     fall out of step with the first.
 */

// Same shape as SYNC_SECRET: a working default so the screen can be set up
// without a deploy, meant to be overridden in the server's .env.
const DISPLAY_KEY = process.env.DISPLAY_KEY ?? "mwalimu-display";

/**
 * The shop's trading day, not the server's.
 *
 * This server runs UTC; Nairobi is UTC+3. Between midnight and 03:00 UTC the
 * two disagree, so a board built from the server's own date would go blank
 * for three hours while the shop was still trading — and, worse, would look
 * exactly like a shop with nothing in the queue.
 *
 * Anchored in UTC because that is how Prisma stores a @db.Date; building it
 * from local parts would land a day early for anyone east of Greenwich.
 */
function kenyanToday(): Date {
  const shop = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(shop.getUTCFullYear(), shop.getUTCMonth(), shop.getUTCDate()));
}

function requireDisplayKey(req: any, res: any, next: any) {
  const given = req.query.key ?? req.headers["x-display-key"];
  if (given !== DISPLAY_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

/**
 * Everything the screen draws, in one call.
 *
 * "Ready" is capped: a screen showing forty numbers is a screen nobody reads.
 * The most recently readied come first, because a customer whose number was
 * called an hour ago has either collected or is at the counter arguing, and
 * either way the screen is not what will help them.
 */
router.get("/state", requireDisplayKey, async (_req, res) => {
  try {
    const day = kenyanToday();

    const [ready, preparing, media] = await Promise.all([
      prisma.ticket.findMany({
        where: { ticketDay: day, state: "READY" },
        orderBy: { readyAt: "desc" },
        take: 12,
        select: { ticketCode: true, band: true, readyAt: true }
      }),
      prisma.ticket.count({ where: { ticketDay: day, state: "OPEN" } }),
      prisma.displayMedia.findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, url: true, caption: true }
      })
    ]);

    res.json({
      data: {
        ready: ready.map(t => ({
          code: t.ticketCode,
          band: t.band,
          readyAt: t.readyAt
        })),
        preparing,
        media,
        serverTime: new Date()
      }
    });
  } catch (err: any) {
    console.error("[display] state failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to read display state" });
  }
});

/* ── Managing the photos ───────────────────────────────────────────────
 *
 * The images themselves go through the existing /uploads endpoint, which
 * already accepts the base64 data URL a browser canvas produces. These routes
 * only ever handle the resulting URL, so there is no image handling on the
 * server at all — no native library, nothing to rebuild when Node moves.
 */

router.get("/media", requireRoles(["ADMIN", "ACCOUNTS", "FRONTDESK"]), async (_req, res) => {
  try {
    const media = await prisma.displayMedia.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    res.json({ data: media });
  } catch (err: any) {
    console.error("[display] media list failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to list media" });
  }
});

router.post("/media", requireRoles(["ADMIN", "ACCOUNTS", "FRONTDESK"]), async (req, res) => {
  try {
    const url = String(req.body?.url ?? "").trim();
    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    // New photos go to the end rather than the front, so adding one does not
    // reshuffle a running screen.
    const last = await prisma.displayMedia.findFirst({ orderBy: { sortOrder: "desc" } });

    const created = await prisma.displayMedia.create({
      data: {
        url,
        caption: req.body?.caption ? String(req.body.caption).slice(0, 120) : null,
        sortOrder: (last?.sortOrder ?? 0) + 1
      }
    });
    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error("[display] media create failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to add media" });
  }
});

router.patch("/media/:id", requireRoles(["ADMIN", "ACCOUNTS", "FRONTDESK"]), async (req, res) => {
  try {
    const data: any = {};
    if (typeof req.body?.enabled === "boolean") data.enabled = req.body.enabled;
    if (typeof req.body?.sortOrder === "number") data.sortOrder = req.body.sortOrder;
    if (typeof req.body?.caption === "string") data.caption = req.body.caption.slice(0, 120);

    if (!Object.keys(data).length) {
      res.status(400).json({ error: "Nothing to change" });
      return;
    }

    const updated = await prisma.displayMedia.update({
      where: { id: String(req.params.id) },
      data
    });
    res.json({ data: updated });
  } catch (err: any) {
    console.error("[display] media update failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to update media" });
  }
});

router.delete("/media/:id", requireRoles(["ADMIN", "ACCOUNTS", "FRONTDESK"]), async (req, res) => {
  try {
    // The row goes; the uploaded file stays. Removing it would break any other
    // page that happens to reference the same upload, and a few stray images
    // in a folder cost far less than a broken picture somewhere nobody looks.
    await prisma.displayMedia.delete({ where: { id: String(req.params.id) } });
    res.json({ data: { deleted: true } });
  } catch (err: any) {
    console.error("[display] media delete failed", err?.message ?? err);
    res.status(500).json({ error: "Unable to remove media" });
  }
});
