-- DisplayMedia: the product photos on the customer-facing screen.
--
-- Generated with `prisma migrate diff` rather than written by hand, so the
-- column types, index name and primary-key constraint are exactly what the
-- Prisma client expects.
--
-- See README.md in this folder for why this cannot go through `prisma db push`.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS "DisplayMedia" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisplayMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DisplayMedia_enabled_sortOrder_idx"
    ON "DisplayMedia"("enabled", "sortOrder");
