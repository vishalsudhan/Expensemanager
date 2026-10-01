# Personal Expense Manager

A mobile-first personal expense manager, planned as an installable PWA with INR as its default currency. Development is intentionally staged; the current deliverable is the application foundation only.

## Run & Operate

- `pnpm --filter @workspace/expense-manager run dev` — run the web app
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — generate a SQL migration from the Drizzle schema
- `pnpm --filter @workspace/db run migrate` — apply generated migrations to the development database
- `pnpm --filter @workspace/db run seed` — add repeatable sample records to development only
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required environment: `DATABASE_URL` — provided by the project's PostgreSQL database and consumed by Drizzle.

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

Personal expense tracking, project context, reusable global categories and labels, and spending reports. Stages 1–6 are implemented: the responsive app shell, data model, project/category/label management, and expense list, entry, detail, edit, and delete flows. Expense search/filtering, reports, and offline entry remain later stages; wait for approval before starting the next stage.

## User preferences

- Keep the product personal, simple, mobile-first, fast, offline-capable, and easy to extend.
- INR (₹) is the initial default currency.

## Gotchas

- The app is currently at the root preview path (`/`); keep its route and asset URLs compatible with that base.
- The service worker excludes `/api/` requests and only covers the application shell; offline expense entry and sync belong to Stage 11.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
