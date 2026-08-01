/**
 * FumasV5 password compatibility.
 *
 * The new system authenticates against the same `users` table as the legacy
 * desktop app, so it must reproduce that app's password cipher byte for byte.
 * Reverse-engineered from the decompiled `SymmCrypto` class.
 *
 * Legacy behaviour, and why each detail matters:
 *
 *   - The passphrase "?Bogus!Key$" is right-padded with 'X' to 16 bytes. There
 *     is no hash and no salt. 16 bytes selects TWO-key 3DES (K1‖K2‖K1), which
 *     is Node's `des-ede-cbc` — NOT `des-ede3-cbc`, which expects 24 bytes.
 *   - The declared IV is 32 bytes but .NET truncates it to the 8-byte block
 *     size, so only the first 8 bytes are ever used.
 *   - Plaintext is encoded as ASCII: .NET's Encoding.ASCII maps every byte
 *     above 0x7F to '?', so a non-ASCII password is lossy on the legacy side
 *     too. We reproduce that rather than "fixing" it, because the stored
 *     ciphertext was produced under those rules.
 *
 * The IV is fixed and global, which makes this deterministic: identical
 * passwords produce identical ciphertext. That is a real weakness of the
 * legacy scheme, but changing it would lock every existing user out. Treat
 * these hashes as legacy credentials to migrate away from, not to build on.
 */

import * as crypto from "crypto";

const CIPHER = "des-ede-cbc";

/** "?Bogus!Key$" right-padded to 16 bytes with 'X'. */
export const LEGACY_KEY = Buffer.from("?Bogus!Key$XXXXX", "ascii");

/** First 8 bytes of the legacy 32-byte IV — the rest is discarded by .NET. */
export const LEGACY_IV = Buffer.from("0cf10a155a4a0b27", "hex");

/**
 * Encrypt a plaintext password into the Base64 form stored in `users.password`.
 * Use this to build the comparison value when authenticating.
 */
export function encryptPassword(plaintext: string): string {
  const cipher = crypto.createCipheriv(CIPHER, LEGACY_KEY, LEGACY_IV);
  return Buffer.concat([
    cipher.update(Buffer.from(plaintext, "ascii")),
    cipher.final(),
  ]).toString("base64");
}

/**
 * Decrypt a stored password back to plaintext.
 *
 * Returns null on any failure. The legacy implementation swallowed errors and
 * returned an empty string, which would then compare equal to an empty stored
 * password — an accidental auth bypass. Returning null makes the failure
 * impossible to confuse with a successful decrypt of "".
 */
export function decryptPassword(ciphertextBase64: string): string | null {
  try {
    const decipher = crypto.createDecipheriv(CIPHER, LEGACY_KEY, LEGACY_IV);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, "base64")),
      decipher.final(),
    ]).toString("ascii");
  } catch {
    return null;
  }
}

/**
 * Known-good pairs captured from the legacy implementation.
 *
 * Asserted by the unit tests and again by the application's startup
 * self-check, so that an environment which can no longer produce this cipher
 * (an OpenSSL build dropping 3DES, say) fails loudly at launch rather than
 * silently rejecting every login.
 */
export const GOLDEN_VECTORS: ReadonlyArray<{ plaintext: string; ciphertext: string }> = [
  { plaintext: "admin", ciphertext: "bsTilD4F1XE=" },
  { plaintext: "1234", ciphertext: "67TvTIQ6Cgs=" },
];

/** True when this runtime still reproduces the legacy cipher exactly. */
export function verifyCryptoAvailable(): boolean {
  try {
    return GOLDEN_VECTORS.every(
      v => encryptPassword(v.plaintext) === v.ciphertext &&
           decryptPassword(v.ciphertext) === v.plaintext,
    );
  } catch {
    return false;
  }
}
