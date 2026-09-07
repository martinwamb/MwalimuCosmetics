-- Clock-in photos, for the tablet at the front desk.
--
-- Two nullable columns and an index. Additive, so it is safe to run while the
-- API is up, and safe to run twice.
--
-- This is here rather than in the deploy because `prisma db push` cannot alter
-- this database at all: the diff wants to drop the mirror_* tables, Prisma
-- refuses, and the `|| true` in the deploy step swallows the refusal and
-- reports success. A model that reaches the server as code but never as a table
-- shows up as a 500 from the route that uses it. See README.md in this folder.
--
-- Generated with:
--   prisma migrate diff --from-schema-datamodel <previous schema>
--                       --to-schema-datamodel   packages/db/prisma/schema.prisma
--                       --script
--
-- Apply on the server, BEFORE deploying the code:
--   export DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/back/.env | cut -d= -f2- | tr -d '"')
--   psql "$DATABASE_URL" -f 2026-09-07_clocking_photos.sql
-- (do not `source` that .env - it has a line that is not shell-safe)

ALTER TABLE "Clocking" ADD COLUMN IF NOT EXISTS "photoIn"  TEXT;
ALTER TABLE "Clocking" ADD COLUMN IF NOT EXISTS "photoOut" TEXT;

CREATE INDEX IF NOT EXISTS "Clocking_userId_timeIn_idx" ON "Clocking"("userId", "timeIn");
