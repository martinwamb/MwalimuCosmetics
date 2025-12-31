import { Router } from "express";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/authz.js";

const FRONT_BASE_URL = process.env.FRONT_BASE_URL ?? "https://mwalimucosmetics.com";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? new URL(FRONT_BASE_URL).hostname;
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? FRONT_BASE_URL;

const registrationSchema = z.object({
  response: z.any()
});

const authenticationSchema = z.object({
  response: z.any()
});

export const router = Router();

function ensureStaff(req: any, res: any): boolean {
  if (req.user?.role === "CUSTOMER") {
    res.status(403).json({ error: "Staff only" });
    return false;
  }
  return true;
}

router.post("/register/options", requireAuth, async (req: any, res) => {
  if (!ensureStaff(req, res)) return;
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const existing = await prisma.webAuthnCredential.findMany({
    where: { userId: user.id }
  });

  const options = await generateRegistrationOptions({
    rpName: "Mwalimu Cosmetics",
    rpID: RP_ID,
    userID: user.id,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    attestationType: "none",
    excludeCredentials: existing.map((cred) => ({
      id: Buffer.from(cred.credentialId, "base64url"),
      type: "public-key",
      transports: cred.transports ? (JSON.parse(cred.transports) as string[]) : undefined
    }))
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { biometricRef: options.challenge }
  });

  res.json({ options });
});

router.post("/register/verify", requireAuth, async (req: any, res) => {
  if (!ensureStaff(req, res)) return;
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.biometricRef) {
    return res.status(400).json({ error: "Missing registration challenge" });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: parsed.data.response,
      expectedChallenge: user.biometricRef,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Biometric registration failed" });
    }

    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    const credentialId = Buffer.from(credentialID).toString("base64url");
    const publicKey = Buffer.from(credentialPublicKey).toString("base64");

    await prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId,
        publicKey,
        counter,
        transports: JSON.stringify(parsed.data.response?.response?.transports ?? [])
      }
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { biometricRef: null }
    });

    res.json({ verified: true });
  } catch (err: any) {
    console.error("[webauthn] register verify failed", err?.message ?? err);
    return res.status(400).json({ error: "Biometric registration failed" });
  }
});

router.post("/authenticate/options", requireAuth, async (req: any, res) => {
  if (!ensureStaff(req, res)) return;
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const creds = await prisma.webAuthnCredential.findMany({ where: { userId: user.id } });
  if (!creds.length) {
    return res.status(400).json({ error: "No registered biometrics" });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: creds.map((cred) => ({
      id: Buffer.from(cred.credentialId, "base64url"),
      type: "public-key",
      transports: cred.transports ? (JSON.parse(cred.transports) as string[]) : undefined
    }))
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { biometricRef: options.challenge }
  });

  res.json({ options });
});

router.post("/authenticate/verify", requireAuth, async (req: any, res) => {
  if (!ensureStaff(req, res)) return;
  const parsed = authenticationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user || !user.biometricRef) {
    return res.status(400).json({ error: "Missing authentication challenge" });
  }

  const credentialId = parsed.data.response?.id;
  if (!credentialId) {
    return res.status(400).json({ error: "Missing credential id" });
  }

  const stored = await prisma.webAuthnCredential.findUnique({ where: { credentialId } });
  if (!stored) {
    return res.status(400).json({ error: "Credential not found" });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: parsed.data.response,
      expectedChallenge: user.biometricRef,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialID: Buffer.from(stored.credentialId, "base64url"),
        credentialPublicKey: Buffer.from(stored.publicKey, "base64"),
        counter: stored.counter,
        transports: stored.transports ? (JSON.parse(stored.transports) as string[]) : undefined
      }
    });

    if (!verification.verified) {
      return res.status(400).json({ error: "Biometric verification failed" });
    }

    await prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: verification.authenticationInfo.newCounter }
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { biometricRef: null }
    });

    res.json({ verified: true });
  } catch (err: any) {
    console.error("[webauthn] auth verify failed", err?.message ?? err);
    return res.status(400).json({ error: "Biometric verification failed" });
  }
});
