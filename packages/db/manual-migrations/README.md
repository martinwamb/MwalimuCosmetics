# Migrations that have to be applied by hand

## Why this folder exists

`prisma db push` **cannot alter the production database, and nothing says so.**

The deploy step is `prisma db push ... || true`. On this database it always
fails: the `mirror_*` tables — around 956,000 rows written by raw SQL, outside
the Prisma schema — would be dropped, so Prisma refuses without
`--accept-data-loss`. The `|| true` swallows the refusal and the deploy reports
success.

So **a new model reaches the server as code but never as a table**, and the
first sign of it is a 500 from the route that uses it. That is a bad way to
find out, and it has already happened once.

**Never pass `--accept-data-loss` here.** It would do exactly what Prisma is
warning about.

## Adding a model

Get Prisma's own DDL rather than writing it by hand — the column types, the
index names and the primary-key constraint all have to match what the client
expects, and hand-written DDL that is subtly different fails at query time
rather than at migration time:

```bash
npx prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-schema-datamodel    packages/db/prisma/schema.prisma \
  --script
```

Save the statements for the new model here, then apply them through `psql` on
the server. Keeping the file means the next person can see what was run, and
can tell whether a given environment has had it.

`--from-empty` in place of `--from-schema-datasource` produces the DDL for the
whole schema without needing to reach the database, which is how
`2026-08-28_ticket.sql` was generated while the shop LAN was disconnected. Take
only the statements for the new model.

## Applying one

```bash
ssh hetzner-martin
psql "$DATABASE_URL" -f /srv/mwalimu/packages/db/manual-migrations/<file>.sql
```

Every file here is written to be safe to run twice — `IF NOT EXISTS` throughout
— so a re-run on an environment that already has the table is a no-op rather
than an error.

## The real fix, still outstanding

Bring the `mirror_*` tables into the Prisma schema, or move them into their own
Postgres schema so `db push` stops seeing them as drift. Until then, every new
model needs a file here.

## What has been applied

| File | Model | Applied to production |
|---|---|---|
| (none — done ad hoc) | `TicketLink` | 2026-08-26 |
| `2026-08-28_ticket.sql` | `Ticket` | 2026-08-29 |
| `2026-08-29_displaymedia.sql` | `DisplayMedia` | 2026-08-29 |
