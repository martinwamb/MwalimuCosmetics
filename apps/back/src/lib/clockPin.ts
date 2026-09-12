import crypto from "crypto";
import { prisma } from "./prisma.js";

/**
 * Clock-in PINs.
 *
 * Stored as an HMAC-SHA256 keyed by a server secret rather than a bcrypt hash,
 * and both reasons come from the PIN being four digits.
 *
 * The unique index on User.clockPinHash is what guarantees no two people share
 * a PIN, and an index can only compare values that come out the same every
 * time. bcrypt salts each hash, so one PIN held by two people would look like
 * two different values and the clash would never be seen.
 *
 * And a slow hash buys nothing over 10,000 possibilities: a leaked table falls
 * to a laptop in minutes however slow each guess is. What keeps a leaked table
 * unreadable is a key the table does not contain.
 *
 * Changing the key (CLOCK_PIN_SECRET, or JWT_SECRET while that is standing in
 * for it) stops every stored PIN matching, and everybody needs a new one.
 */
const PIN_KEY = process.env.CLOCK_PIN_SECRET || process.env.JWT_SECRET || "dev-secret";

export const PIN_MAX_FAILS = 5;
export const PIN_LOCK_MINUTES = 15;

export function hashPin(pin: string) {
  return crypto.createHmac("sha256", PIN_KEY).update(pin).digest("hex");
}

export function pinMatches(pin: unknown, storedHash: unknown) {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return false;
  if (typeof storedHash !== "string" || !/^[0-9a-f]{64}$/i.test(storedHash)) return false;
  const given = Buffer.from(hashPin(pin), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (given.length !== stored.length) return false;
  return crypto.timingSafeEqual(given, stored);
}

// The PINs people pick for themselves, and so the first ones anybody tries on
// somebody else's name: one digit four times, or a run up or down the keypad.
export function isTrivialPin(pin: string) {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if (step !== 1 && step !== -1) return false;
  return d.every((v, i) => i === 0 || v - d[i - 1] === step);
}

export function randomPin() {
  for (;;) {
    const pin = String(crypto.randomInt(0, 10000)).padStart(4, "0");
    if (!isTrivialPin(pin)) return pin;
  }
}

// A clash on the PIN index, as opposed to one on the email: only that kind is
// worth retrying with different digits.
function isPinClash(err: any) {
  if (err?.code !== "P2002") return false;
  const target = err?.meta?.target;
  return !target || String(target).includes("clockPinHash");
}

/**
 * Runs a write that stores a new PIN hash, drawing fresh digits whenever the
 * unique index says somebody already has them.
 *
 * With a couple of dozen staff in 10,000 PINs a clash is rare, so fifty draws
 * running out means something else is wrong rather than bad luck.
 */
export async function withFreshPin<T>(write: (hash: string) => Promise<T>) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pin = randomPin();
    try {
      const result = await write(hashPin(pin));
      return { pin, result };
    } catch (err: any) {
      if (isPinClash(err)) continue;
      throw err;
    }
  }
  throw new Error("Could not find a free PIN");
}

/**
 * Issues or replaces one person's PIN and returns the digits - the only time
 * they exist outside the tablet's keypad. Clears the fail count and any lock,
 * because a reset is how an admin lets somebody locked out back in.
 */
export async function issuePin(userId: string) {
  const { pin } = await withFreshPin(clockPinHash =>
    prisma.user.update({
      where: { id: userId },
      data: { clockPinHash, clockPinFails: 0, clockPinLockedUntil: null },
      select: { id: true }
    })
  );
  return pin;
}
