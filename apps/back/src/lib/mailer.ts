import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { prisma } from "./prisma.js";

type MailStatus = "QUEUED" | "SENT" | "FAILED";

type SendInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  userId?: string | null;
};

const MAIL_FROM = process.env.MAIL_FROM ?? "notifications@mwalimucosmetics.com";

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";

  if (!host || !port) {
    return null;
  }

  const options: SMTPTransport.Options = {
    host,
    port,
    secure
  };

  if (user && pass) {
    options.auth = { user, pass };
  }

  return nodemailer.createTransport(options);
}

const transport = buildTransport();

export async function sendAppMail(input: SendInput) {
  const { to, subject, text, html, userId } = input;

  let status: MailStatus = "SENT";
  let errorMessage: string | null = null;

  if (!transport) {
    status = "QUEUED";
    console.log(`[mail] No SMTP configured. Would send to ${to}: ${subject}`);
  } else {
    try {
      await transport.sendMail({
        from: MAIL_FROM,
        to,
        subject,
        text,
        html
      });
    } catch (err: any) {
      status = "FAILED";
      errorMessage = err?.message ?? "Send failed";
      console.error("[mail] Failed to send", errorMessage);
    }
  }

  await prisma.mailMessage.create({
    data: {
      to,
      from: MAIL_FROM,
      subject,
      body: html ?? text,
      direction: "OUTBOUND",
      status,
      userId: userId ?? null
    }
  });

  if (errorMessage) {
    throw new Error(errorMessage);
  }
}
