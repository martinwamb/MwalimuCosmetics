import { Router } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { requireRoles } from "../lib/authz.js";

const uploadSchema = z.object({
  filename: z.string().optional(),
  data: z.string().min(10) // expect base64 data URL or raw base64
});

const uploadsDir = path.resolve("uploads");
function ensureDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

export const router = Router();

router.post("/", requireRoles(["ADMIN"]), (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { filename, data } = parsed.data;
  ensureDir();

  // Support data URLs or plain base64
  const base64 = data.includes(",") ? data.split(",").pop() ?? data : data;
  const buffer = Buffer.from(base64, "base64");
  const ext = filename?.includes(".") ? filename.split(".").pop() : "png";
  const name = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(uploadsDir, name);

  try {
    fs.writeFileSync(filePath, buffer);
    const publicUrl = `/uploads/${name}`;
    const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "http";
    const host = req.headers.host ?? req.get("host") ?? "";
    const absolute = `${proto}://${host}${publicUrl}`;
    return res.status(201).json({ url: absolute, path: publicUrl });
  } catch (err: any) {
    console.error("[uploads] failed", err);
    return res.status(500).json({ error: "Failed to save file" });
  }
});
