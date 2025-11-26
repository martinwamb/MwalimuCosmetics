import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@mwalimu.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-now";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

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
  password: z.string().min(6)
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

async function seedAdmin() {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await prisma.user.create({
    data: { email: ADMIN_EMAIL, passwordHash, role: "ADMIN" }
  });
  return admin;
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
      role: "CUSTOMER"
    }
  });

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

  // Placeholder: hook email/SMS provider here with a real tokenized link.
  console.log(`[auth] Password reset requested for ${parsed.data.email}`);
  return res.status(200).json({ message: "Password reset link has been queued." });
});

router.get("/staff", requireAdmin, async (_req, res) => {
  const list = await prisma.user.findMany({
    where: { role: { in: ["ACCOUNTS", "SALES", "ADMIN", "CUSTOMER"] } },
    select: { id: true, email: true, role: true, createdAt: true }
  });
  res.json({ data: list });
});

router.post("/logout", (_req, res) => {
  // JWT is stateless; client drops token.
  res.status(204).send();
});
