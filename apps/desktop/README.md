# Mwalimu Cosmetics — desktop application

The replacement for FumasV5. It reads the same `mwalimuinvest` database, so
everyone signs in with the username and password they already use and all the
existing history is there from the first launch.

## Installing

Run `Mwalimu-Setup-<version>.exe` and follow the prompts. It installs for all
users on the machine, so it needs an administrator.

Windows will most likely warn that the publisher is unknown, because the
installer is not code-signed. Choose **More info → Run anyway**. Signing costs
money annually and is only worth buying if this warning becomes a nuisance.

## First run

The sign-in screen runs a check before anything else and shows what it found:

| Check | What it means if it fails |
|---|---|
| Password compatibility | This machine cannot reproduce the format FumasV5 stores passwords in, so nobody could sign in. Should never fail; if it does, do not go further. |
| Database configured | No server details entered yet. |
| Database reachable | The shop's MySQL cannot be reached from here. Usually the network rather than the app. |
| Stock procedures present | The database is missing `do_stock_transactions`. Stock could not be recorded correctly against it. |

If the database is not reachable, **Open settings** on the sign-in screen lets
you enter the connection details without signing in first.

Settings are stored at `C:\ProgramData\Mwalimu\config.json`, not inside the
application, so upgrades leave them alone. **The database password is never
compiled into the application** — an installer is readable by anyone who has
it, so a password inside one is a password everyone has.

## Read-only by default

New installations cannot write to the database. This is deliberate: point it
at the live shop data, explore every screen, and nothing can be altered.

Writing is turned on per machine in **Settings → Writing to the database**,
knowingly, once you are satisfied it behaves.

## Being a good neighbour to the tills

The shop's MySQL server also serves the counters, and it cannot be worked on
out of hours because every machine is switched off when the shop closes. So
this app deliberately paces itself: there is a small pause between queries,
adjustable in Settings. If the tills ever feel sluggish while someone is
browsing here, raise it.

## What is in this version

Everything reads; nothing writes.

- **Dashboard** — takings, VAT, discounts and returns for a day; how it was
  paid; best sellers over the past week; items running low. It also warns
  about accounting periods that are locked or missing before they stop the
  tills, and flags ledger entries whose debits and credits do not match.
- **Items & stock** — search the catalogue, see prices and live stock, and
  click any item for its recent movements.
- **Sales** — receipts for a date range, with the lines behind each one.
  Parked receipts are marked: those were started but never paid for, so they
  are not counted in the takings.
- **Suppliers** — what is owed, per creditor.
- **Settings** — connection details, pacing, and the values read from the
  shop's own configuration.

Menu entries follow the same per-form rights as FumasV5, from the same
`users_rights` table, so people see what they saw before. Unlike the old
system there is no hidden administrator override: rights come only from the
rights table.

## Building it yourself

From the repository root:

```
npm install
npm run build   --workspace=@mwalimu/fumas-core
npm run package --workspace=@mwalimu/desktop
```

The installer lands in `apps/desktop/release/`.

For development, `npm run dev --workspace=@mwalimu/desktop` runs Vite with the
Electron shell pointed at it.

## How it is put together

All database access happens in Electron's main process. The interface runs
sandboxed with no Node integration and can only call the named operations
listed in `electron/preload.ts`. There is no channel for arbitrary SQL, so
the interface can ask for a supplier balance but cannot express a query.

The rules that matter — how VAT and discounts combine, how a receipt total is
rounded, what makes a ledger entry balance — live in `@mwalimu/fumas-core`,
which is shared with the sync agent so the two cannot drift apart and start
disagreeing about the books.
