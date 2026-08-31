import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

import { sendAppMail } from "../lib/mailer.js";
import { prisma } from "../lib/prisma.js";
import { seedAdmin } from "../lib/admin.js";
import { requireAuth } from "../lib/authz.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const PASSWORD_RESET_URL = process.env.PASSWORD_RESET_URL ?? "https://mwalimucosmetics.com/reset-password";
const FRONT_BASE_URL = process.env.FRONT_BASE_URL ?? "https://mwalimucosmetics.com";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID ?? "";
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET ?? "";

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const staffCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["ACCOUNTS", "SALES", "ADMIN"]) // Staff roles are admin-managed only
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional(),
  marketingOptIn: z.boolean().optional()
});

const identifySchema = z.object({
  email: z.string().email()
});

const forgotSchema = z.object({
  email: z.string().email()
});

export const router = Router();

function signToken(user: { id: string; email: string; role: string }) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

function buildBaseUrl(req: any) {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "http";
  const host = req.headers.host ?? req.get("host") ?? "localhost:4000";
  return `${proto}://${host}`;
}

function sanitizeRedirect(candidate?: string | null) {
  if (!candidate) return FRONT_BASE_URL;
  if (candidate.startsWith(FRONT_BASE_URL)) return candidate;
  if (candidate.startsWith("http://localhost:3000")) return candidate;
  return FRONT_BASE_URL;
}

function signOAuthState(payload: { redirect: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "10m" });
}

function verifyOAuthState(token?: string | null) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as { redirect: string };
  } catch {
    return null;
  }
}

async function ensureCustomerRecord(email: string, name?: string | null, marketingOptIn?: boolean) {
  const existing = await prisma.customer.findFirst({ where: { email } });
  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: name ?? existing.name,
        marketingOptIn: typeof marketingOptIn === "boolean" ? marketingOptIn : existing.marketingOptIn
      }
    });
  }
  return prisma.customer.create({
    data: {
      name: name ?? "Customer",
      email,
      marketingOptIn: marketingOptIn ?? false
    }
  });
}

async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return user;
}

function requireAdmin(req: any, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }
  const token = header.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.role !== "ADMIN") {
      return res.status(403).json({ error: "Admin token required" });
    }
    req.user = payload;
    return next();
  } catch (_err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // ensure admin exists before login attempts
  await seedAdmin();

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken(user);
  return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

router.post("/staff", requireAdmin, async (req, res) => {
  const parsed = staffCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) {
    return res.status(409).json({ error: "User with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const created = await prisma.user.create({
    data: {
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role
    }
  });

  return res.status(201).json({ data: { id: created.id, email: created.email, role: created.role } });
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) {
    return res.status(409).json({ error: "User with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const created = await prisma.user.create({
    data: {
      email: parsed.data.email,
      passwordHash,
      name: parsed.data.name ?? null,
      role: "CUSTOMER"
    }
  });

  await ensureCustomerRecord(parsed.data.email, parsed.data.name ?? null, parsed.data.marketingOptIn ?? false);

  const token = signToken(created);
  return res.status(201).json({ token, user: { id: created.id, email: created.email, role: created.role } });
});

router.post("/identify", async (req, res) => {
  const parsed = identifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // Ensure the bootstrap admin exists for first-time setups.
  await seedAdmin();

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, role: true }
  });

  const isStaff = user ? user.role !== "CUSTOMER" : false;
  return res.json({
    exists: Boolean(user),
    role: user?.role ?? null,
    kind: isStaff ? "STAFF" : "CUSTOMER"
  });
});

router.post("/forgot", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // We do not send email yet; we acknowledge the request to avoid leaking user existence.
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true }
  });

  if (!user) {
    return res.status(200).json({ message: "If that account exists, reset instructions have been queued." });
  }

  const resetLink = `${PASSWORD_RESET_URL}?email=${encodeURIComponent(parsed.data.email)}`;
  try {
    await sendAppMail({
      to: parsed.data.email,
      subject: "Reset your Mwalimu Cosmetics password",
      text: `We received a password reset request for this account. If this was you, use this link: ${resetLink}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>We received a password reset request for this account.</p><p>If this was you, use this link:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, you can ignore this email.</p>`
    });
  } catch (err: any) {
    console.error("[auth] Failed to send reset email", err?.message ?? err);
  }

  return res.status(200).json({ message: "Password reset link has been queued." });
});

router.get("/staff", requireAdmin, async (_req, res) => {
  const list = await prisma.user.findMany({
    where: { role: { in: ["ACCOUNTS", "SALES", "ADMIN"] } },
    select: { id: true, email: true, role: true, createdAt: true }
  });
  res.json({ data: list });
});

router.get("/oauth/google/start", async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send("Google OAuth is not configured.");
  }
  const redirect = sanitizeRedirect((req.query.redirect as string | undefined) ?? null);
  const state = signOAuthState({ redirect });
  const redirectUri = `${buildBaseUrl(req)}/auth/oauth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

router.get("/oauth/google/callback", async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !googleClient) {
    return res.status(500).send("Google OAuth is not configured.");
  }
  const code = req.query.code as string | undefined;
  const state = verifyOAuthState(req.query.state as string | undefined);
  const redirect = sanitizeRedirect(state?.redirect ?? null);
  if (!code) {
    return res.redirect(`${redirect}?error=missing_code`);
  }
  try {
    const redirectUri = `${buildBaseUrl(req)}/auth/oauth/google/callback`;
    const body = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokenData?.error ?? "Token exchange failed");
    }
    const idToken = tokenData.id_token as string | undefined;
    if (!idToken) {
      throw new Error("Missing id_token");
    }
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload?.email;
    const name = payload?.name ?? null;
    if (!email) {
      throw new Error("No email from Google");
    }
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);
      user = await prisma.user.create({
        data: { email, passwordHash, role: "CUSTOMER", name }
      });
    }
    await ensureCustomerRecord(email, name, false);
    const token = signToken(user);
    const params = new URLSearchParams({
      token,
      email,
      role: user.role
    });
    res.redirect(`${redirect}?${params.toString()}`);
  } catch (err: any) {
    console.error("[auth] Google OAuth failed", err?.message ?? err);
    res.redirect(`${redirect}?error=google_oauth_failed`);
  }
});

router.get("/oauth/facebook/start", async (req, res) => {
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    return res.status(500).send("Facebook OAuth is not configured.");
  }
  const redirect = sanitizeRedirect((req.query.redirect as string | undefined) ?? null);
  const state = signOAuthState({ redirect });
  const redirectUri = `${buildBaseUrl(req)}/auth/oauth/facebook/callback`;
  const url = new URL("https://www.facebook.com/v18.0/dialog/oauth");
  url.searchParams.set("client_id", FACEBOOK_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "email,public_profile");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

router.get("/oauth/facebook/callback", async (req, res) => {
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    return res.status(500).send("Facebook OAuth is not configured.");
  }
  const code = req.query.code as string | undefined;
  const state = verifyOAuthState(req.query.state as string | undefined);
  const redirect = sanitizeRedirect(state?.redirect ?? null);
  if (!code) {
    return res.redirect(`${redirect}?error=missing_code`);
  }
  try {
    const redirectUri = `${buildBaseUrl(req)}/auth/oauth/facebook/callback`;
    const tokenUrl = new URL("https://graph.facebook.com/v18.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", FACEBOOK_APP_ID);
    tokenUrl.searchParams.set("client_secret", FACEBOOK_APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokenData?.error?.message ?? "Token exchange failed");
    }
    const accessToken = tokenData.access_token as string | undefined;
    if (!accessToken) {
      throw new Error("Missing access token");
    }
    const profileUrl = new URL("https://graph.facebook.com/me");
    profileUrl.searchParams.set("fields", "id,name,email");
    profileUrl.searchParams.set("access_token", accessToken);
    const profileRes = await fetch(profileUrl.toString());
    const profile = await profileRes.json();
    if (!profileRes.ok) {
      throw new Error(profile?.error?.message ?? "Profile fetch failed");
    }
    const email = profile?.email as string | undefined;
    const name = (profile?.name as string | undefined) ?? null;
    if (!email) {
      return res.redirect(`${redirect}?error=facebook_missing_email`);
    }
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);
      user = await prisma.user.create({
        data: { email, passwordHash, role: "CUSTOMER", name }
      });
    }
    await ensureCustomerRecord(email, name, false);
    const token = signToken(user);
    const params = new URLSearchParams({
      token,
      email,
      role: user.role
    });
    res.redirect(`${redirect}?${params.toString()}`);
  } catch (err: any) {
    console.error("[auth] Facebook OAuth failed", err?.message ?? err);
    res.redirect(`${redirect}?error=facebook_oauth_failed`);
  }
});

/**
 * Is this token still any good?
 *
 * The dashboard keeps its JWT in localStorage and, until now, treated the mere
 * PRESENCE of one as being signed in. Tokens last seven days, so a week after
 * signing in the sidebar, the role badge and the email all still render
 * perfectly while every request behind them returns 401 — and each page
 * reports that in its own words, as its own failure. "Could not load the photo
 * list" is a true statement and a completely misleading one.
 *
 * One cheap authenticated call the shell can make on load turns that into the
 * thing it actually is: a session that has run out.
 */
router.get("/me", requireAuth, (req: any, res) => {
  res.json({ data: { email: req.user?.email ?? null, role: req.user?.role ?? null } });
});

router.post("/logout", (_req, res) => {
  // JWT is stateless; client drops token.
  res.status(204).send();
});
