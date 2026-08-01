import { describe, it, expect } from "vitest";
import {
  encryptPassword,
  decryptPassword,
  verifyCryptoAvailable,
  GOLDEN_VECTORS,
} from "../src/crypto/password";

describe("legacy password cipher", () => {
  // If these fail, nobody can log in. They are the contract with every
  // password already stored in the production `users` table.
  it.each(GOLDEN_VECTORS)("encrypts $plaintext to the stored ciphertext", ({ plaintext, ciphertext }) => {
    expect(encryptPassword(plaintext)).toBe(ciphertext);
  });

  it.each(GOLDEN_VECTORS)("decrypts the stored ciphertext back to $plaintext", ({ plaintext, ciphertext }) => {
    expect(decryptPassword(ciphertext)).toBe(plaintext);
  });

  it("round-trips passwords of varying length across block boundaries", () => {
    for (const p of ["a", "1234567", "12345678", "123456789", "a longer passphrase here"]) {
      expect(decryptPassword(encryptPassword(p))).toBe(p);
    }
  });

  it("is deterministic, matching the legacy fixed-IV behaviour", () => {
    expect(encryptPassword("repeat")).toBe(encryptPassword("repeat"));
  });

  it("returns null rather than empty string on undecryptable input", () => {
    // The legacy implementation returned "" here, which then compared equal to
    // an empty stored password. Guarding that is the whole point.
    expect(decryptPassword("not-valid-base64-ciphertext")).toBeNull();
    expect(decryptPassword("")).toBeNull();
  });

  it("reports crypto availability for the startup self-check", () => {
    expect(verifyCryptoAvailable()).toBe(true);
  });
});
