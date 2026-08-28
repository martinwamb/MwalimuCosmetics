-- Ticket: collection tickets mirrored from the shop, so the web can see the
-- queue and a customer can open their own receipt from the QR on the slip.
--
-- Generated with `prisma migrate diff` rather than written by hand, so the
-- column types, index names and primary-key constraint are exactly what the
-- Prisma client expects. Hand-written DDL that is subtly different fails at
-- query time instead of at migration time.
--
-- See README.md in this folder for why this cannot go through `prisma db push`.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS "Ticket" (
    "id" TEXT NOT NULL,
    "ticketDay" DATE NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "band" VARCHAR(1) NOT NULL,
    "seq" INTEGER NOT NULL,
    "receiptno" TEXT NOT NULL,
    "arname" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "etaLo" INTEGER NOT NULL,
    "etaHi" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "till" TEXT,
    "staff" TEXT,
    "readyAt" TIMESTAMP(3),
    "readyBy" TEXT,
    "collectedAt" TIMESTAMP(3),
    "collectedBy" TEXT,
    "receiptToken" TEXT,
    "items" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_receiptno_key"          ON "Ticket"("receiptno");
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_receiptToken_key"       ON "Ticket"("receiptToken");
CREATE        INDEX IF NOT EXISTS "Ticket_ticketDay_state_idx"    ON "Ticket"("ticketDay", "state");
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_ticketDay_ticketCode_key" ON "Ticket"("ticketDay", "ticketCode");
