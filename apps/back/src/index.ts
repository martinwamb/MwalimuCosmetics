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
import { router as mailRouter } from "./routes/mail.js";
import { router as uploadRouter } from "./routes/uploads.js";
import { seedAdmin } from "./lib/admin.js";

const app = express();
const port = process.env.PORT || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use("/uploads", express.static("uploads"));

app.use("/health", healthRouter);
app.use("/products", productRouter);
app.use("/orders", orderRouter);
app.use("/bank", bankRouter);
app.use("/ai", aiRouter);
app.use("/auth", authRouter);
app.use("/mail", mailRouter);
app.use("/uploads", uploadRouter);

seedAdmin()
  .catch((err) => {
    console.error("Failed to seed admin user", err);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });
  });
