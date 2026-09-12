-- Clock-in PINs, and who appears on the tablet's board of names.
--
-- Four columns on "User" and a unique index, then two data fixes. Additive, so
-- it is safe to run while the API is up. The DDL is IF NOT EXISTS throughout
-- and the UPDATEs land on the same values a second time, so it is safe to run
-- twice - with one caveat: a re-run hides the four accounts below again, even
-- if an admin has since put one of them back on the board.
--
-- The unique index is what guarantees no two people share a PIN. It is built
-- while every "clockPinHash" is NULL, and Postgres allows any number of NULLs
-- under a unique index, so it cannot fail on the rows already there.
--
-- This is here rather than in the deploy because `prisma db push` cannot alter
-- this database at all: the diff wants to drop the mirror_* tables, Prisma
-- refuses, and the `|| true` in the deploy step swallows the refusal and
-- reports success. A column that reaches the server as code but never as a
-- column shows up as a 500 from every route that names it - here, the tablet's
-- board of names and the Staff page. See README.md in this folder.
--
-- Generated with:
--   prisma migrate diff --from-schema-datamodel <previous schema>
--                       --to-schema-datamodel   packages/db/prisma/schema.prisma
--                       --script
--
-- Apply on the server, BEFORE deploying the code:
--   export DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/back/.env | cut -d= -f2- | tr -d '"')
--   psql "$DATABASE_URL" -f 2026-09-12_clock_pin.sql
-- (do not `source` that .env - it has a line that is not shell-safe)

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clockPinHash"        TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clockPinFails"       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clockPinLockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clockBoard"          BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "User_clockPinHash_key" ON "User"("clockPinHash");

-- Martin, the lowercase "martin" placeholder added from the tablet, ZR. Mwalimu,
-- and the Tickets & Screen kiosk account. Hidden from the board, not switched
-- off: every one of those logins carries on working.
UPDATE "User" SET "clockBoard" = false WHERE id IN ('cmartin00000000000000001','cmtuzrmxrr8h5zgtejouhf6co','cmix38pmj000067bwncco5zjt','cmtnzgvfr0000ixkdsjctx5g7');

-- Leah's account has no name, so the board shows her email; the second name is
-- taken from that email. It only fills a blank, so a name set on the Staff page
-- in the meantime is left alone.
UPDATE "User" SET name = 'Leah Wamuyu' WHERE email = 'leah.wamuyu@mwalimucosmetics.com' AND (name IS NULL OR name = '');
