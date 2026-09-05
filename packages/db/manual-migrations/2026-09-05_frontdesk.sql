-- FRONTDESK: a login for the ticket board and the shop screen, and the two
-- things the staff page needs to exist at all.
--
-- Every statement below was generated with `prisma migrate diff` and copied out
-- of it — NOT written by hand. Column types, index names and constraint names
-- have to be exactly what the client expects, and hand-written DDL that is
-- subtly different fails at query time rather than at migration time.
--
-- WHAT WAS LEFT OUT, AND WHY IT MATTERS: that same diff also wanted to
-- DROP TABLE on all eight mirror_* tables — about 956,000 rows written by raw
-- SQL outside the Prisma schema. That is the whole reason this folder exists
-- and the reason `prisma db push` must never be let near this database. Only
-- the three changes actually wanted are below.
--
-- ORDER: apply this BEFORE deploying the code. Code that writes 'FRONTDESK',
-- reads User.disabled or touches PasswordReset will throw against a database
-- that has none of them. The other way round is harmless.
--
-- Safe to run twice.

-- ── The role ─────────────────────────────────────────────────────────
--
-- ADD VALUE cannot run inside a transaction block, so this file must not be
-- wrapped in BEGIN/COMMIT. And it is a ONE-WAY DOOR: Postgres can add an enum
-- value but not remove one.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FRONTDESK';

-- ── Taking a login away ──────────────────────────────────────────────
--
-- Not deleting the row: sales, clockings and mail all point at it, so removing
-- a person would take their history with them.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabled" BOOLEAN NOT NULL DEFAULT false;

-- ── Password resets ──────────────────────────────────────────────────
--
-- tokenHash, not token. A reset token is a temporary password, and a database
-- that leaks should not hand over working ones.
CREATE TABLE IF NOT EXISTS "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordReset_userId_idx" ON "PasswordReset"("userId");
CREATE INDEX IF NOT EXISTS "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

-- Re-running this file must not fail on an existing constraint, and Postgres
-- has no ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
