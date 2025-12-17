-- Adds mail enums and MailMessage table, and links to User

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'MailDirection' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "MailDirection" AS ENUM ('INBOUND', 'OUTBOUND');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'MailStatus' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "MailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "MailMessage" (
    "id" TEXT PRIMARY KEY,
    "to" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "direction" "MailDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status" "MailStatus" NOT NULL DEFAULT 'SENT',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- add FK only if column exists and FK not already present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MailMessage' AND column_name = 'userId'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      WHERE tc.table_name = 'MailMessage'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'MailMessage_userId_fkey'
    ) THEN
      ALTER TABLE "MailMessage"
      ADD CONSTRAINT "MailMessage_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END$$;
