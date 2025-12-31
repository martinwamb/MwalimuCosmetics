import { Router } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/authz.js";
import { uploadsDir } from "../lib/uploads.js";

const clockSchema = z.object({
  selfieData: z.string().optional(),
  deviceRef: z.string().optional()
});

export const router = Router();

function ensureDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

function isStaff(req: any) {
  return req.user?.role && req.user.role !== "CUSTOMER";
}

async function saveSelfie(data: string, req: any) {
  ensureDir();
  const base64 = data.includes(",") ? data.split(",").pop() ?? data : data;
  const buffer = Buffer.from(base64, "base64");
  const name = `${crypto.randomUUID()}.png`;
  const filePath = path.join(uploadsDir, name);
  fs.writeFileSync(filePath, buffer);
  const publicPath = `/uploads/${name}`;
  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "http";
  const host = req.headers.host ?? req.get("host") ?? "";
  return `${proto}://${host}${publicPath}`;
}

router.post("/", requireAuth, async (req: any, res) => {
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Staff only" });
  }

  const parsed = clockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const open = await prisma.clocking.findFirst({
      where: { userId: req.user.sub, timeOut: null },
      orderBy: { timeIn: "desc" }
    });

  const selfieUrl = parsed.data.selfieData ? await saveSelfie(parsed.data.selfieData, req) : null;
  const deviceRef = parsed.data.deviceRef ?? null;

    if (open) {
    const updated = await prisma.clocking.update({
      where: { id: open.id },
      data: {
        timeOut: new Date(),
        deviceRef: deviceRef ?? open.deviceRef
      }
    });
    return res.json({ data: updated, status: "CLOCKED_OUT" });
  }

  const created = await prisma.clocking.create({
    data: {
      userId: req.user.sub,
      timeIn: new Date(),
      deviceRef: deviceRef ?? "selfie"
    }
  });
    return res.status(201).json({ data: created, status: "CLOCKED_IN" });
  } catch (err: any) {
    console.error("[clockings] save failed", err?.message ?? err);
    return res.status(500).json({ error: "Unable to record clocking" });
  }
});
