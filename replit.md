# Personal Expense Manager

A mobile-first personal expense manager, planned as an installable PWA with INR as its default currency. Development is intentionally staged.

## Run & Operate

- Start the Replit workflows `artifacts/api-server: API Server` and `artifacts/expense-manager: web` to run the app. The workflows supply the required environment and preview routing.
- The web app is served at `/`; the API is served at `/api` (internal port 8080). The web workflow supplies `PORT=19111` and `BASE_PATH=/`.
- `pnpm install --frozen-lockfile` — install the existing workspace dependencies after import
- `pnpm --filter @workspace/expense-manager run dev` — web workflow command (requires `PORT` and `BASE_PATH`)
- `pnpm --filter @workspace/api-server run dev` — API workflow command (requires `PORT` and `DATABASE_URL`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — generate a SQL migration from the Drizzle schema
- `pnpm --filter @workspace/db run migrate` — apply generated migrations to the development database
- `pnpm --filter @workspace/db run seed` — add repeatable sample records to development only
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required environment: `DATABASE_URL` — provided by the project's PostgreSQL database and consumed by Drizzle.
- The imported migration has been applied to the development database; no sample data was added. `/api/healthz` checks database connectivity.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React, Vite, Tailwind CSS, Wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- PWA: web app manifest, app icons, and a service worker for the offline application shell

## Where things live

- `artifacts/expense-manager` — React app, route shell, and PWA assets
- `artifacts/api-server` — Express API, including the database-backed health check
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema` — Drizzle table definitions, validation schemas, relations, and types
- `lib/db/drizzle` — generated SQL migrations and migration journal
- `lib/db/seed.sql` — idempotent development sample data; refuses production
- `lib/db/drizzle.config.ts` — PostgreSQL/Drizzle configuration

## Architecture decisions

- Categories are global and never belong to a project.
- Projects are optional context on expenses; categories are required.
- Labels are global and connect to expenses many-to-many.
- Complete only the currently approved stage; pause for user approval before starting the next stage.

## Product

Personal expense tracking, project context, reusable global categories and labels, and spending reports. Stages 1–16 are implemented: the responsive app shell, data model, project/category/label management, and the expense list, entry, detail, edit, and delete flows, plus server-backed expense search, filtering (date range, project, category, label, payment method), sorting (newest/oldest/highest/lowest amount), and paginated loading on the Expenses page. The home dashboard (Stage 8) adds total spent for today/week/month/all-time, a day/week/month spending trend, category and project breakdowns, recent expenses, and a quick-add shortcut, all sourced from a single `/api/dashboard` endpoint. The Reports page (Stage 9) adds monthly, weekly, and custom-range spending reports (total, count, average, category/project/label breakdowns, and a daily chart) plus all-time project, category, and label reports with per-entity six-month trends, served by `/api/reports/period`, `/api/reports/projects`, `/api/reports/categories`, and `/api/reports/labels`. Reports are interactive (Stage 10): every total, breakdown row, and month bar links to the Expenses page with URL-encoded `projectId`, `categoryId`, `labelId`, `from`, and `to` filters that combine, and all filtered totals are aggregated in SQL from the matching expense records. The app is an installable offline-capable PWA (Stage 11): the manifest and generated PNG/maskable icons make it installable, a versioned service worker caches the application shell and same-origin GET API responses, new expenses can be entered while offline and are kept in an IndexedDB outbox, and queued expenses sync automatically when the connection returns (with manual retry and a connectivity indicator that distinguishes offline, syncing, pending, and failed states) so an expense is never silently lost. Data management (Stage 12) lives on a real Settings page: expenses, projects, categories, and labels can each be exported as CSV, a complete JSON backup captures projects, categories, labels, expenses, and their label links, and a backup can be imported back. Import validates the whole document — structure, duplicate names and ids, and referential integrity — before merging it in a single transaction that matches existing records by id or name and never deletes anything. Wait for approval before starting the next stage.

Stage 13 is a mobile-first polish pass: shared money/date/error helpers (`src/lib/format.ts`), consistent 40–44px touch targets, safe-area-aware layout and toasts, a keyboard-accessible sheet-based "More" menu with a skip link and route focus management, friendlier empty/loading/error/not-found states (unknown UUID expense/category/project ids show a not-found screen instead of a retry), form validation that focuses the first invalid field (expenses) and a keyboard-submittable custom-range form (reports), accessible charts, non-destructive archive confirmations, export success toasts plus a 25 MB client-side import guard, and a light/dark/system appearance control (`src/lib/theme.ts` + `src/components/theme-control.tsx`) with a no-flash inline script.

Stage 14 is the end-to-end QA pass: a single automated browser suite exercises the full product surface — creating and archiving projects/categories/labels, creating expenses with and without a project, multi-label editing, URL-driven search/filter combinations, deletion, CSV export and JSON backup import, offline outbox capture and automatic reconnect sync, reports (monthly/weekly/project/category/label) cross-checked against the API, mobile layout with no horizontal overflow, PWA manifest/service-worker install checks, and direct database persistence, all with automatic cleanup that restores the baseline. The pass also hardened the API: the Postgres pool now registers an `error` listener (`lib/db/src/index.ts`) so a transient idle-client network error can no longer crash the server.

Stage 15 is the production-preparation pass. The API now sends security headers (HSTS in production, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, COOP/CORP, `Permissions-Policy`), disables `x-powered-by`, sets `Cache-Control: no-store` on personal data, applies in-memory rate limits (`600/min` general, `20/min` on backup import), configures CORS from an optional `CORS_ORIGINS` allowlist (same-origin only by default in production), returns JSON for unknown `/api/*` routes, and maps body-parser/validation failures to safe JSON errors without leaking internals (`src/middlewares/security.ts`, `src/app.ts`). The Postgres pool gained production settings (`DB_POOL_MAX` default 10, 30s idle timeout, 10s connect timeout, `application_name`) plus a per-client `error` listener so a dropped connection mid-query can no longer crash the process (`lib/db/src/index.ts`), and `expenses` gained `(project_id, date)` and `(amount)` indexes (`lib/db/src/schema/expenses.ts`). The web build gates the runtime error overlay behind `NODE_ENV !== "production"` and splits `node_modules` into a single `vendor` chunk (all chunks under 500 kB). PWA/SEO/branding were finalized: `apple-mobile-web-app-title` corrected to "Pocketful", `application-name`/OpenGraph/Twitter image and a generated 180×180 `apple-touch-icon` added, the service worker cache bumped to `v4` (with `event.waitUntil` guaranteeing cache writes are not dropped), and `.gitignore` now excludes `.env*` (`.env.example` documents required variables).

Stage 16 is basic multi-currency support, deliberately **without** exchange rates: there is no conversion, no stored rate, and no base currency. A `currencies` master table (`id`, `code`, `name`, `symbol`, `decimal_places`, `is_active`) is seeded with INR, QAR, AED, USD, EUR, and GBP and served by `/api/currencies` (list, create, and enable/disable via `PATCH`), with management in Settings. Every project has a required `default_currency_id` and every expense its own required `currency_id`; when a project is picked in the expense form its default currency is suggested, and the user can always override it. Every aggregate is grouped by currency, so totals are reported as `CurrencyAmount[]` (`currency`, `total`, `count`, and a `share` measured only within the same currency) instead of a single scalar — amounts are never summed across currencies. This replaced the scalar `totalSpent`/`totalAmount`/`total`/`average`/`share` fields across expenses, projects, categories, the dashboard, and every report (`lib/api-spec/openapi.yaml`), and `share`/per-currency averages moved inside the grouped entries. Aggregates use shared helpers in `src/lib/currency-amounts.ts`, and money is formatted from the ISO code through `Intl` (`src/lib/format.ts`, `money`/`moneyByCode`/`formatTotals`). Backup export/import carries currency **codes** (portable across installs) rather than uuids. Migration `0001_outstanding_zombie.sql` creates the table, seeds it, adds both columns as nullable, backfills existing rows to INR, then promotes them to `NOT NULL` — no records or amounts changed. The pass also fixed two real bugs: `useCurrencyOptions` returned a fresh array each render (re-running form effects), and `invalidateQueries` after a project write could be swallowed by an in-flight list fetch, leaving a newly created project invisible until reload (`refreshProjectLists` now cancels before refetching).


## User preferences

- Keep the product personal, simple, mobile-first, fast, offline-capable, and easy to extend.
- INR (₹) is the initial default currency.

## Gotchas

- The app is currently at the root preview path (`/`); keep its route and asset URLs compatible with that base.
- The service worker (`public/sw.js`, cache version `v4`) caches the app shell and same-origin GET `/api/` responses (network-first, falling back to the last good cache and returning a 503 JSON payload when truly offline). Non-GET requests are never intercepted; offline expense writes are queued in IndexedDB by `src/lib/offline-store.ts` and flushed by `src/components/offline-provider.tsx` when the browser reports it is online again.
- Backups use the `pocketful-backup` document (version 1) served by `GET /api/backup`; CSV exports live under `GET /api/export/{expenses,projects,categories,labels}`. `POST /api/backup/import` validates structure, duplicate names and ids, and referential integrity before merging by id or name inside one transaction; it upserts and never deletes. `express.json` accepts up to `25mb` so large backups import cleanly.

- Appearance lives in `localStorage` under `pocketful-theme` (`light` | `dark` | `system`, default `dark`). An inline script in `index.html` applies the `.dark` class before paint to avoid a flash; `src/lib/theme.ts` keeps it in sync and the `ThemeControl` in Settings changes it.
- Amounts are never summed across currencies. Any new aggregate must `GROUP BY currencies.id` and surface `CurrencyAmount[]` (`src/lib/currency-amounts.ts`); a single scalar total is a bug. Format money with `money(amount, currency)` / `formatTotals(totals)` from `src/lib/format.ts`, never a hardcoded `INR` — and note `Intl` renders some currencies by code (QAR shows as `QAR`, not `﷼`).
- Backup and CSV documents carry currency **codes**, not uuids, so a file stays portable across installs. `BackupProject.defaultCurrency` and `BackupExpense.currency` are required on import and are resolved against the local currency master.
- After any write that changes a list, prefer `refreshProjectLists` in `src/pages/Projects.tsx` over a bare `invalidateQueries`: an in-flight list fetch can otherwise resolve with pre-write data and swallow the invalidation.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
