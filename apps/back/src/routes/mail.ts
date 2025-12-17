import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRoles } from "../lib/authz.js";
import { sendAppMail } from "../lib/mailer.js";

export const router = Router();

const sendSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
});

router.get("/", requireAuth, async (req: any, res) => {
  const user = req.user as { sub: string; email: string; role: string };
  const take = Math.min(Number(req.query.take ?? 20), 100);
  const skip = Number(req.query.skip ?? 0);

  const messages = await prisma.mailMessage.findMany({
    where: {
      OR: [{ userId: user.sub }, { to: user.email }]
    },
    orderBy: { createdAt: "desc" },
    take,
    skip
  });

  res.json({ data: messages });
});

router.post("/send", requireRoles(["ADMIN", "ACCOUNTS", "SALES"]), async (req: any, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    await sendAppMail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      text: parsed.data.body,
      userId: req.user?.sub
    });
    res.status(202).json({ message: "Queued" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Send failed" });
  }
});
