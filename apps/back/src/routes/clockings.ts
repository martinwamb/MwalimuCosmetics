import { Router } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles } from "../lib/authz.js";
import { clockingsDir } from "../lib/uploads.js";
import { PIN_LOCK_MINUTES, PIN_MAX_FAILS, pinMatches, withFreshPin } from "../lib/clockPin.js";
import { STAFF_ROLES } from "./auth.js";

/**
 * Clocking in and out, from the tablet at the front desk.
 *
 * The tablet is signed in once, as the tickets account, and stays that way all
 * day. Staff do not sign in and out of it - they tap their own name on a board
 * of names. So the account making the request is almost never the person being
 * clocked, which is why userId is a parameter here rather than being read off
 * the token.
 *
 * Three things stand behind a press. The tap names who. The PIN proves who:
 * four digits of their own, unique across the shop, with five wrong in a row
 * locking that name for a quarter of an hour. And the camera, which the tablet
 * opens without a preview, takes a picture that is kept as the evidence. The
 * picture is only saved once the PIN is right, so what is kept is a record of
 * shifts rather than of every mistyped digit.
 *
 * What a PIN cannot do is tell its owner from somebody they gave it to. Two
 * people sharing one PIN look exactly like one person to this code, and the
 * only thing that can show it is the wrong face in the photo, which is only as
 * good as somebody looking. Closing that for good needs a fingerprint or face
 * terminal doing one-to-many identification, which no browser can drive - a
 * tablet's own sensor only ever answers "the device owner is present", and on
 * a shared tablet every enrolled finger is the device owner.
 */

const clockSchema = z.object({
  // A data URL from the tablet's canvas. Optional: a tablet with a broken
  // camera, or a refused permission, must not stop somebody starting work.
  selfieData: z.string().optional(),
  deviceRef: z.string().optional(),
  // Absent means "clock me", which is what this endpoint has always done.
  userId: z.string().optional(),
  // Required whenever the press is for somebody else - see the gate below.
  pin: z.string().max(12).optional()
});

export const router = Router();

// Who may clock somebody OTHER than themselves. The tablet runs as FRONTDESK.
const KIOSK_ROLES = ["FRONTDESK", "ADMIN"];

const SYNC_SECRET = process.env.SYNC_SECRET ?? "mwalimu-sync-secret";

// The shop's pusher rather than a person: it has the sync secret and no login.
function requireSyncSecret(req: any, res: any, next: any) {
  if (req.headers["x-sync-secret"] !== SYNC_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function ensureDir() {
  if (!fs.existsSync(clockingsDir)) {
    fs.mkdirSync(clockingsDir, { recursive: true });
  }
}

function isStaff(req: any) {
  return req.user?.role && req.user.role !== "CUSTOMER";
}

/**
 * Writes the photo and returns the bare filename.
 *
 * A filename, not a URL: these are served back through a guarded route, and a
 * stored absolute URL would also bake in whatever host happened to answer the
 * request that created it.
 */
function saveSelfie(data: string) {
  ensureDir();
  const base64 = data.includes(",") ? data.split(",").pop() ?? data : data;
  const buffer = Buffer.from(base64, "base64");
  const name = `${crypto.randomUUID()}.jpg`;
  fs.writeFileSync(path.join(clockingsDir, name), buffer);
  return name;
}

// Midnight in Nairobi, expressed as an instant. The server runs UTC and Kenya
// is UTC+3, so between 00:00 and 03:00 UTC "today" on this box is still
// yesterday in the shop - and an early shift would be filed under the wrong
// day. Same reasoning as the ticket board.
function shopDayStart(iso?: string) {
  const base = iso ? new Date(`${iso}T00:00:00.000Z`) : new Date(Date.now() + 3 * 60 * 60 * 1000);
  if (Number.isNaN(base.getTime())) return null;
  const midnight = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  return new Date(midnight - 3 * 60 * 60 * 1000);
}

// "14:05" on the shop's clock, for telling somebody when a lock lifts.
function shopClock(d: Date) {
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return `${String(eat.getUTCHours()).padStart(2, "0")}:${String(eat.getUTCMinutes()).padStart(2, "0")}`;
}

function lockedReply(res: any, until: Date) {
  return res.status(423).json({
    code: "LOCKED",
    error: `Too many wrong PINs. Try again after ${shopClock(until)}.`,
    until
  });
}

/**
 * Locks the name if every try has been used, and returns the count and the lock
 * as they now stand. The condition is in the database, so whichever press finds
 * the tries spent sets the lock. If the press that made the fifth miss died
 * before locking, the count would otherwise sit at five with no lock to expire,
 * and nobody - the right PIN included - would ever get another try.
 */
async function lockIfSpent(userId: string, now: Date) {
  const until = new Date(now.getTime() + PIN_LOCK_MINUTES * 60 * 1000);
  const locked = await prisma.user.updateMany({
    where: { id: userId, clockPinFails: { gte: PIN_MAX_FAILS } },
    data: { clockPinFails: 0, clockPinLockedUntil: until }
  });
  if (locked.count) {
    console.warn(`[clockings] PIN locked for ${userId} until ${until.toISOString()}`);
  }
  return prisma.user.findUnique({
    where: { id: userId },
    select: { clockPinFails: true, clockPinLockedUntil: true }
  });
}

/**
 * The board of names the tablet draws.
 *
 * Names, clock state and whether the person has a PIN yet, and nothing else.
 * No roles, no figures - this is rendered on a screen facing the shop floor.
 */
router.get("/roster", requireAuth, async (req: any, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff only" });
  }

  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: STAFF_ROLES as unknown as any[] }, disabled: false, clockBoard: true },
      select: { id: true, name: true, email: true, clockPinHash: true }
    });

    // One query rather than one per person: an open clocking is any row with no
    // timeOut, and there is at most one per user by construction.
    const open = await prisma.clocking.findMany({
      where: { userId: { in: staff.map(s => s.id) }, timeOut: null },
      select: { userId: true, timeIn: true }
    });
    const since = new Map(open.map(o => [o.userId, o.timeIn]));

    // Sorted on the name as shown. Somebody with no name is shown by their
    // email, and the database would put all of those after everybody else.
    const data = staff
      .map(s => ({
        id: s.id,
        name: s.name ?? s.email,
        state: since.has(s.id) ? "IN" : "OUT",
        since: since.get(s.id) ?? null,
        hasPin: Boolean(s.clockPinHash)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

    return res.json({ data });
  } catch (err: any) {
    console.error("[clockings] roster failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to read the roster" });
  }
});

/**
 * Registering somebody new, from the tablet.
 *
 * A new assistant starts on a morning when no admin is about, and they need to
 * be on the board that day. So the front desk can add a name - and only a name.
 *
 * What it deliberately cannot do is grant anything. The account is created with
 * the least-privileged role there is (FRONTDESK: the ticket board, the shop
 * screen and this page, nothing else) and a random password nobody ever sees,
 * not even the person who typed the name. So it is a row on this board and a
 * placeholder for an admin, not a way in. Setting the real role, the real email
 * and a real password is the Staff page's job, which is ADMIN only.
 *
 * It does hand back a PIN, in the same write, because a name on the board with
 * no PIN cannot be clocked in, and the new person is standing at the tablet.
 * That is not a way in either: a PIN only works on this page, for this name.
 * The response is the only time the digits exist; a lost one is replaced from
 * the Staff page.
 *
 * The generated email is a placeholder on a domain that does not receive mail,
 * so a password reset cannot be sent to it either. An admin corrects it later.
 */
const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().email().max(120).optional()
});

function placeholderEmail(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 30);
  return `${slug || "staff"}.${crypto.randomUUID().slice(0, 6)}@staff.invalid`;
}

router.post("/staff", requireRoles(KIOSK_ROLES), async (req: any, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "A name of at least two characters is required" });
  }

  try {
    const email = (parsed.data.email ?? placeholderEmail(parsed.data.name)).toLowerCase();

    const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (clash) {
      return res.status(409).json({ error: "Somebody already uses that email" });
    }

    // Random, and thrown away. The account cannot be signed into until an admin
    // sets a password, which is the point.
    const passwordHash = await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 12);

    const { pin, result: user } = await withFreshPin(clockPinHash =>
      prisma.user.create({
        data: { name: parsed.data.name, email, role: "FRONTDESK", passwordHash, clockPinHash },
        select: { id: true, name: true, email: true }
      })
    );

    return res.status(201).json({
      data: { id: user.id, name: user.name ?? user.email, state: "OUT", since: null, hasPin: true },
      pin
    });
  } catch (err: any) {
    console.error("[clockings] register failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to add that person" });
  }
});

/**
 * The toggle. One press clocks in, the next clocks out.
 *
 * Keyed on "is there an open clocking for this person", so it cannot get out of
 * step with itself the way a separate state column could.
 */
router.post("/", requireAuth, async (req: any, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff only" });
  }

  const parsed = clockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "That clocking could not be read" });
  }

  const targetId = parsed.data.userId ?? req.user.sub;
  if (targetId !== req.user.sub && !KIOSK_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "You can only clock yourself in" });
  }

  try {
    if (targetId !== req.user.sub) {
      const target = await prisma.user.findUnique({
        where: { id: targetId },
        select: {
          role: true, disabled: true, clockBoard: true,
          clockPinHash: true, clockPinFails: true, clockPinLockedUntil: true
        }
      });
      // A switched-off account is somebody who no longer works here, a customer
      // was never staff, and a name taken off the board is not clocked from the
      // tablet. None of them should get a shift by being asked for by id.
      if (!target || target.disabled || !target.clockBoard
          || !(STAFF_ROLES as readonly string[]).includes(target.role)) {
        return res.status(404).json({ error: "No such staff member" });
      }
      if (!target.clockPinHash) {
        return res.status(403).json({ code: "NO_PIN", error: "No PIN yet - ask the admin to issue one." });
      }

      // The lock before the PIN, so the right PIN during a lock is refused too.
      // Otherwise the lock would only slow a guesser down, never stop one.
      const now = new Date();
      if (target.clockPinLockedUntil && target.clockPinLockedUntil > now) {
        return lockedReply(res, target.clockPinLockedUntil);
      }

      const pin = parsed.data.pin;
      // Nothing typed is not a guess, so it does not count towards the lock.
      // A tablet still running the page from before PINs sends none at all,
      // and counting those would lock out everybody who pressed their name.
      if (!pin) {
        return res.status(403).json({
          code: "WRONG_PIN",
          error: "Wrong PIN.",
          remaining: Math.max(0, PIN_MAX_FAILS - target.clockPinFails)
        });
      }

      // A try is claimed in the database before the PIN is compared, rather than
      // counted after. The lock above was read once, so a burst of guesses sent
      // together would all pass it and all be answered - the whole keypad in one
      // go. The claim only succeeds while tries are left and no lock stands, so
      // however many arrive at once, at most five PINs are compared per lock.
      const claim = await prisma.user.updateMany({
        where: {
          id: targetId,
          clockPinFails: { lt: PIN_MAX_FAILS },
          OR: [{ clockPinLockedUntil: null }, { clockPinLockedUntil: { lte: now } }]
        },
        data: { clockPinFails: { increment: 1 } }
      });
      if (!claim.count) {
        const after = await lockIfSpent(targetId, now);
        if (after?.clockPinLockedUntil && after.clockPinLockedUntil > now) {
          return lockedReply(res, after.clockPinLockedUntil);
        }
        // No lock after all: a right PIN cleared the count in between.
        return res.status(409).json({ error: "That press crossed another - press again." });
      }

      if (!pinMatches(pin, target.clockPinHash)) {
        const after = await lockIfSpent(targetId, now);
        if (after?.clockPinLockedUntil && after.clockPinLockedUntil > now) {
          return lockedReply(res, after.clockPinLockedUntil);
        }
        return res.status(403).json({
          code: "WRONG_PIN",
          error: "Wrong PIN.",
          remaining: Math.max(0, PIN_MAX_FAILS - (after?.clockPinFails ?? PIN_MAX_FAILS))
        });
      }

      // The claim counted this try as a miss until the compare said otherwise.
      await prisma.user.update({
        where: { id: targetId },
        data: { clockPinFails: 0, clockPinLockedUntil: null }
      });
    }

    const open = await prisma.clocking.findFirst({
      where: { userId: targetId, timeOut: null },
      orderBy: { timeIn: "desc" }
    });

    // Only reached once the PIN has passed, and saved before the write, so a
    // failure here fails the whole press rather than recording a shift whose
    // photo silently went missing.
    const photo = parsed.data.selfieData ? saveSelfie(parsed.data.selfieData) : null;
    const deviceRef = parsed.data.deviceRef ?? req.user.email ?? null;

    if (open) {
      const updated = await prisma.clocking.update({
        where: { id: open.id },
        data: {
          timeOut: new Date(),
          deviceRef: deviceRef ?? open.deviceRef,
          photoOut: photo ?? open.photoOut
        }
      });
      return res.json({ data: updated, status: "CLOCKED_OUT" });
    }

    const created = await prisma.clocking.create({
      data: {
        userId: targetId,
        timeIn: new Date(),
        deviceRef,
        photoIn: photo
      }
    });
    return res.status(201).json({ data: created, status: "CLOCKED_IN" });
  } catch (err: any) {
    console.error("[clockings] save failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to record clocking" });
  }
});

/**
 * The day's shifts - ADMIN only.
 *
 * A clock-in nobody can read back records nothing, and this is also the only
 * way the photos can be looked at.
 */
router.get("/", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    const day = req.query.day ? String(req.query.day) : undefined;
    const from = shopDayStart(day);
    if (!from) {
      return res.status(400).json({ error: "Bad day" });
    }
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    const rows = await prisma.clocking.findMany({
      where: { timeIn: { gte: from, lt: to } },
      orderBy: { timeIn: "asc" },
      select: {
        id: true, timeIn: true, timeOut: true, deviceRef: true,
        photoIn: true, photoOut: true,
        user: { select: { name: true, email: true } }
      }
    });

    return res.json({
      data: rows.map(r => ({
        id: r.id,
        name: r.user.name ?? r.user.email,
        timeIn: r.timeIn,
        timeOut: r.timeOut,
        deviceRef: r.deviceRef,
        // Minutes, not hours: the front end can round however it likes, and a
        // shift still running has no length yet.
        minutes: r.timeOut
          ? Math.round((r.timeOut.getTime() - r.timeIn.getTime()) / 60000)
          : null,
        hasPhotoIn: Boolean(r.photoIn),
        hasPhotoOut: Boolean(r.photoOut)
      }))
    });
  } catch (err: any) {
    console.error("[clockings] list failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to read clockings" });
  }
});

/**
 * Recent shifts for the shop's own database - the sync secret, not a login.
 *
 * bridge/pusher.js copies these into staff_clockings in the shop MySQL, which is
 * how the till's Staff performance window shows attendance: the tills have no
 * internet, and the server cannot reach MySQL. `from` goes back with the rows
 * because the pusher deletes shop rows in the window that the server no longer
 * has, and it has to use exactly the window this query used.
 *
 * Everybody, hidden from the board or switched off: this is history, and
 * somebody who has since left still worked the days they worked.
 */
router.get("/export", requireSyncSecret, async (req, res) => {
  try {
    const asked = Math.floor(Number(req.query.days ?? 3));
    const days = Number.isFinite(asked) ? Math.min(120, Math.max(1, asked)) : 3;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.clocking.findMany({
      where: { timeIn: { gte: from } },
      orderBy: { timeIn: "asc" },
      select: {
        id: true, timeIn: true, timeOut: true,
        user: { select: { name: true, email: true } }
      }
    });

    return res.json({
      from,
      data: rows.map(r => ({
        id: r.id,
        name: r.user.name ?? r.user.email,
        timeIn: r.timeIn,
        timeOut: r.timeOut
      }))
    });
  } catch (err: any) {
    console.error("[clockings] export failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to export clockings" });
  }
});

/**
 * One photo - ADMIN only.
 *
 * The filename comes out of the database rather than off the URL, so nothing a
 * caller sends is ever joined onto a path, and basename() is belt as well as
 * braces. `which` is compared against two literals for the same reason.
 */
router.get("/:id/photo/:which", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    const which = String(req.params.which);
    if (which !== "in" && which !== "out") {
      return res.status(404).json({ error: "Not found" });
    }

    const row = await prisma.clocking.findUnique({
      where: { id: String(req.params.id) },
      select: { photoIn: true, photoOut: true }
    });
    const name = which === "in" ? row?.photoIn : row?.photoOut;
    if (!name) {
      return res.status(404).json({ error: "Not found" });
    }

    const file = path.join(clockingsDir, path.basename(name));
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: "Not found" });
    }

    res.type("image/jpeg");
    return res.sendFile(file);
  } catch (err: any) {
    console.error("[clockings] photo failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to read the photo" });
  }
});
