import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { router as healthRouter } from "./routes/health.js";
import { router as productRouter } from "./routes/products.js";
import { router as orderRouter } from "./routes/orders.js";
import { router as bankRouter } from "./routes/banking.js";
import { router as aiRouter } from "./routes/ai.js";
import { router as authRouter } from "./routes/auth.js";
import { prisma } from "./lib/prisma.js";
import bcrypt from "bcryptjs";

const app = express();
const port = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use("/health", healthRouter);
app.use("/products", productRouter);
app.use("/orders", orderRouter);
app.use("/bank", bankRouter);
app.use("/ai", aiRouter);
app.use("/auth", authRouter);

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@mwalimu.com";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "change-me-now";

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) return;

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      role: "ADMIN"
    }
  });
  console.log("Seeded admin user", adminEmail);
}

seedAdmin()
  .catch((err) => {
    console.error("Failed to seed admin user", err);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });
  });
