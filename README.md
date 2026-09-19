# Kesari Cable Network

A customer, payment and monthly recharge app built with **React, Node.js, Express and Supabase PostgreSQL**. React runs locally and Express stores application records online in Supabase.

## Active database

**Supabase PostgreSQL is the application's source of truth.** The server uses the private `kesari` schema: `customers`, `payments`, `recharges` and `metadata`. In Supabase's Table Editor, select the `kesari` schema to view these tables. The browser communicates only with Express; database credentials are never sent to React. TLS certificate verification is enabled.

The SQLite migration preserved **380 customers, 56 payments, 6,628 recharges**, plus the original import metadata. Every field and source order was compared before the import transaction committed. The local `data/kesari.sqlite`, original CSVs and `backups/before-supabase-*.sqlite` remain as historical copies; new app writes go only to PostgreSQL.

Configuration in `.env`:

- `DB_CLIENT=postgres`: use Supabase; no automatic fallback to SQLite.
- `DATABASE_URL`: the project's Session pooler URI with the database password.
- `PGSSLROOTCERT`: the downloaded Supabase CA certificate path.
- `PORT=5191`, `VITE_PORT=5190`: the existing local app ports.

Do not overwrite the configured `.env` with the dummy template. On another computer, copy `.env.example`, fill in the connection values and certificate path, and run the app. `/api/health` confirms `storage: "postgres"` and tests database connectivity. Internet access to Supabase is required.

`npm run migrate:supabase` is the **one-time import command for a fresh target**. It refuses to run when PostgreSQL is already enabled or when the target schema exists. Do not re-import old SQLite records into the live database. The verification receipt is in `backups/supabase-migration-receipt.json`.

## Run

Requires **Node.js 22.13 or newer** (uses Node's built-in SQLite driver).

```sh
npm install
npm run dev
```

- App: **http://127.0.0.1:5190**
- Express API: **http://127.0.0.1:5191**
- Optional production preview: port **5192**

The configured ports avoid every port in the supplied exclusion list. Vite fails if its port is occupied rather than silently moving to a different port.

For a production build served entirely by Express:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:5191**. Stop the development API first because it uses the same port. The default host is loopback, for local use. This version has no user login; add authentication before exposing it beyond this computer.

Edit the existing `.env` to change the host, ports or database settings. Set `VITE_PORT` for the frontend and `PORT` for the backend. `VITE_API_PORT` can override the frontend's API target. Restart both processes after changing these values.

## Original CSV import

The original CSVs were first imported into SQLite, then migrated to PostgreSQL. The following describes that original import, not an ongoing CSV synchronization:

| Source | SQLite table | Imported rows | Empty rows skipped |
| --- | --- | ---: | ---: |
| Summary.csv | customers | 380 | 104 |
| Payment.csv | payments | 56 | 0 |
| Recharge.csv | recharges | 6,628 | 39 |

An import marker is stored in the database. Subsequent startups do not re-import or overwrite edits. Keep the CSV files as the original source snapshot; they are never changed by the app. There is no scheduled Google Sheets or AppSheet dependency.

- Card numbers and phone numbers stay **text**, including leading zeros and letter prefixes.
- CSV dates are interpreted as **M/D/YYYY**, normalized to ISO dates (native DATE columns in PostgreSQL), and displayed as **DD Mon YYYY**.
- Monetary values are integer paise (BIGINT in PostgreSQL), so ₹330.25 is stored as `33025`. A missing amount is `NULL`, not zero.
- Source IDs and row order are preserved for payments and recharges. Customer rows get independent stable UUIDs so a duplicate card never silently overwrites a customer.
- The `sourceRow` column identifies the original CSV row. `createdAt` is the import/create timestamp, not a fabricated historical transaction time.
- Latest recharge date and latest paid-through date are calculated with the maximum recorded end date for that card, as in the AppSheet summary formulas. No balance or debt is inferred from sparse payment history.
- Active means the latest recharge end date is today or later. Business dates use **Asia/Kolkata**.

### Existing data issues

The app preserves and flags issues from the supplied CSVs:

- **1 duplicated card number**, used by two customer rows. Both rows remain visible.
- **692 historical records** without matching customers: 10 payments and 682 recharges.
- **20 reversed date ranges**: 2 payments and 18 recharges.
- Incomplete payment or recharge records also appear in **Needs review**.

The sidebar's **Data review** dialog distinguishes original import counts from current review counts. It links to the records needing attention. Add a customer with a missing card number to resolve historical references automatically. For a duplicate card, review both rows and remove only the redundant customer row. New transactions require a uniquely matching customer. Editing an existing unresolved transaction can retain its historical card reference.

Card-based relationships are deliberately not enforced as database foreign keys because the imported data contains duplicate and unresolved card references. The Express API validates all new references and prevents deleting the last customer row for a card with history. Changing a unique customer's card number updates its related records atomically; changing an ambiguous duplicate card is blocked.

### Backup and restore

```sh
npm run backup
```

In PostgreSQL mode this saves a consistent JSON export of all current application tables in `backups/kesari-postgres-*.json`. **Download backup** in the app also exports current Supabase data as JSON. JSON exports preserve application values but are not automatic restore archives. For a full PostgreSQL backup/restore, use Supabase's database backups or `pg_dump` with the Session pooler connection and verified TLS.

The pre-migration `.sqlite` backup is retained for disaster recovery. It contains data only up to migration time. Restoring it after new PostgreSQL writes would lose those later changes unless they are reconciled first. To deliberately restore the old local version: stop the app, preserve the current `data/` folder elsewhere, copy the chosen `.sqlite` backup to a fresh `data/kesari.sqlite`, explicitly set `DB_CLIENT=sqlite`, and restart. Do not mix a restored database with old `-wal` or `-shm` files. Remove a stale `data/migration.lock` only after inspecting migration status.

**Export CSV** exports the current filtered/selected records from the active database, using original column names. Import card and phone columns into spreadsheets as text to preserve leading zeros.

## Features

- **Recharge Ending Soon** lists customers whose latest recharge end date is yesterday, today, tomorrow, or the day after tomorrow (Asia/Kolkata), matching the supplied AppSheet formula. Search, area filtering, pagination and CSV export retain this date window.

- People, Payment and Recharge views with the original red accent and mobile bottom navigation.
- Customer cards on mobile, desktop tables, search, area filters, date/month filters, payment modes, sorting and pagination.
- Add, edit and delete records with confirmation, server-side validation and useful errors.
- Customer details with complete related payment/recharge history and computed latest dates.
- Searchable customer picker. Optional calendar-month period helper with an inclusive end date.
- Call and WhatsApp links open the user's device apps. Recharge message links prepare confirmation/reminder text; they do not automatically send messages. Local 10-digit mobile numbers use India’s +91 country code; explicit international prefixes are preserved.
- Selected-row CSV exports, full JSON exports and retained pre-migration SQLite backups.
- Original import diagnostics, missing-reference flags and incomplete-record review.

The screenshot's message icons do not reveal custom AppSheet action formulas. The replacement provides explicit, editable WhatsApp drafts for recharge confirmation and expiry reminders.

## Development

```text
src/
  App.jsx                    Main views, filters and actions
  components/                Customer details, forms and accessible dialogs
  lib.js                     API, formatting and downloads
  styles.css                 Desktop and mobile layouts
server/
  db.js                      SQLite schema, one-time import and derived summaries
  app.js                     Express routes, validation and exports
  index.js                   Server startup and shutdown
  backup.js                  Backup/export of the active database
  store.js                   PostgreSQL and SQLite adapters
  postgres-read.js           Filtered PostgreSQL queries and summaries
  postgres-schema.sql        Private PostgreSQL schema
  migrate-postgres.js         Verified one-time SQLite migration
tests/app.test.js            Import reconciliation and API integration tests
```

The original customer CSVs, local databases, backups, certificates and real `.env` are intentionally excluded from GitHub. Configure `.env` from `.env.example` and download your certificate to connect a fresh checkout to the existing Supabase database. Do not run the migration again.

Run `npm test` for import, persistence, CRUD, validation, reference protection, CSV export and backup tests. These historical import tests require the private `Summary.csv`, `Payment.csv` and `Recharge.csv` files in the project root. Tests use an isolated temporary database and never mutate `data/kesari.sqlite`. Run `npm run build` to validate the React production bundle. `npm run test:postgres` explicitly tests the configured online database using temporary records, checks reads/writes/exports and concurrency, then removes the test records. It is not part of the default test suite.

### API

`kind` is `customers`, `payments`, or `recharges`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/health | Availability |
| GET | /api/bootstrap | Summary, customer choices and import report |
| GET | /api/:kind | Filtered, paginated records |
| GET | /api/:kind/:id | Record detail; customer detail includes related history |
| POST | /api/:kind | Create |
| PUT | /api/:kind/:id | Update |
| DELETE | /api/:kind/:id | Delete with history protection |
| GET | /api/:kind/export | Filtered/selected CSV export |
| GET | /api/backup | Complete JSON export |

List/export parameters: `q`, `area`, `status`, `month`, `mode`, `sort`, `ids`. Pagination adds `page` and `pageSize` (maximum 100). Status values include `active`, `expired`, `no-history`, and `review`. Sort values include `source`, `name`, `newest`, `oldest`, and `expiry`.

All writes are validated with Zod and executed with bound SQL parameters. Unknown API routes return JSON errors. Foreign-origin browser writes are blocked. CSV exports escape formula-like text without changing stored data.
