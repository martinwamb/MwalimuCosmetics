import bcrypt from "bcryptjs";

import { prisma } from "./prisma.js";

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "wambugujusk@gmail.com";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-now";

export async function seedAdmin() {
  const existing = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN_EMAIL } });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
  const admin = await prisma.user.create({
    data: { email: DEFAULT_ADMIN_EMAIL, passwordHash, role: "ADMIN" }
  });
  console.log("Seeded admin user", DEFAULT_ADMIN_EMAIL);
  return admin;
}

export function adminDefaults() {
  return { email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD };
}
