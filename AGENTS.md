# AGENTS.md — how to work on this repository

## The golden rule

> **Code moves through Git. Schema changes move through migrations. Data never moves from Development to Production.**

Two environments, and they are not interchangeable:

| | Development | Production |
| --- | --- | --- |
| Database | Neon **development** branch | Neon **production** branch |
| Data | test data, freely disposable | **real user data — do not touch** |
| API | Render (local build) | Render |
| Web | Vercel / local | Vercel |

Development and Production were both originally initialised from the development
database during the first launch. **That is retired.** Production is now
initialised and stays initialised; from this point forward the only thing that
ever moves from Development to Production is a migration file.

If a task would require copying, replacing, seeding, or syncing a database
between environments, stop and say so. That is never the way.

---

## The workflow

### Phase 1 — Development

Work only against the Neon **development** branch.

- Schema changes go in a **new numbered file** in `lib/db/drizzle/`, e.g.
  `0005_budgets.sql`. Never edit a migration that has already been applied —
  `pnpm --filter @workspace/db migrate:up` detects and refuses that.
- Apply it to development: `pnpm --filter @workspace/db migrate:up -- --allow-host`
- Test the feature and everything that already existed.

### Phase 2 — The user tests it

They use the development build and check the feature, the UI, existing
functionality, and that existing development data survived.

Only when they are happy do they approve.

### Phase 3 — Production preparation

Classify the change and report it:

**Code only** (no `.sql`, no schema file) — e.g. a UI change, a new query
parameter, the Reports transaction-type filter.

```
test on development → commit → push main → Render/Vercel deploy → smoke test
```

**Code + schema** — e.g. adding a table.

```
development → migration file → test → commit → push main
            → APPLY MIGRATION TO PRODUCTION → deploy code → smoke test
```

Migration first for an **additive** change, because code that expects a table
that does not exist fails immediately.

**Migration first is wrong** for any change that stops the currently deployed
code from working — a dropped column, a narrowed type, a renamed column. Those
break the running app, so they go **app-deploy-first**. Use expand → migrate →
contract:

1. Add the new column, keep the old one.
2. Deploy code that understands both.
3. Backfill old rows into the new column.
4. Switch the app to the new column.
5. Drop the old column in a **later** release.

### Phase 4 — Promote

- Verify the exact migration that was tested in development.
- Apply **only** the new migration files to production. Never copy data.
- Verify the production schema and row counts before deploying the app.
- Deploy the tested commit.
- Run production smoke tests afterwards.

---

## Backing up

Before a **risky** production schema change (`DROP COLUMN`, `DELETE`,
type changes, renames, large backfills, restructuring relationships) there must
be a recovery point.

Low risk, usually fine without a fresh manual backup: adding a table, a nullable
column, an index.

The app itself can produce a full data export: **Settings → Backup → Export**
(`GET /api/backup`). It contains projects, categories, labels, expenses and
expense labels, and **no** credentials or session tokens. It does not contain
currencies, exchange rates or locations — those come from the migrations and
seed — so it is a data export, not a full database restore.

For high-risk migrations, a **temporary Neon branch off the current production
state** is the best rehearsal: apply the migration to that copy first, verify,
then apply to production and delete the branch. That is different from the
permanent development branch.

---

## Commands

Run database commands through the `@workspace/db` workspace.

| Command | Does |
| --- | --- |
| `migrate:status` | Read-only. What is applied, what is pending. Safe on production. |
| `migrate:up` | Applies pending migrations in order, each in a transaction, recorded in the ledger. |
| `migrate:record <file>` | Marks a migration as already applied **without running it**, after verifying the schema by hand. |
| `db:status` | Read-only report: ledger, schema drift, row counts. Safe on production. |
| `db:generate` | Drizzle generates a migration from schema diffs. |
| `db:seed` | Reference seed. Refuses to run when `NODE_ENV=production`. |

The ledger lives in `schema_migrations (filename, checksum, applied_at, applied_by)`.
The checksum is what enforces immutability: if an applied file is edited on
disk, every later run aborts rather than letting environments diverge silently.

### Guarded, and why

`push` and `push-force` (`drizzle-kit push`) reshape a database with **no
migration file and no record**. They are the fastest way to destroy real data,
so they sit behind `scripts/guard-schema-push.mjs`, which refuses when:

1. `NODE_ENV=production`
2. the host looks like production, unless `ALLOW_PROVIDER_HOST=1`
3. the host is a provider host even then, unless `CONFIRM_SCHEMA_PUSH=1`
4. `--force` is used, unless `CONFIRM_SCHEMA_PUSH_FORCE=1`

Prefer a migration. It is reviewable, recorded, and reversible.

`drizzle-kit migrate` (the `migrate` script) depends on drizzle's own
`__drizzle_migrations` table, which **production does not have** because it was
created by hand. Use `migrate:up` instead.

---

## Verification suites

In `scripts/verify/`. Each builds its own fixtures with a unique run tag and
cleans up after itself.

| Command | Covers |
| --- | --- |
| `verify:records` | Renaming and deleting locations, categories, projects, labels |
| `verify:reports` | Reports transaction-type filter and cumulative filters |
| `verify:stage17` | Locations, category hierarchy, transaction types, multi-currency |
| `verify:auth` | Setup, login, sessions, password reset |

`verify:records` and `verify:reports` need an existing session:

```
DATABASE_URL=… API_URL=http://127.0.0.1:8080 SESSION_COOKIE="pocketful_session=<token>" \
  ALLOW_PROVIDER_HOST=1 pnpm --filter @workspace/scripts run verify:records
```

`verify:stage17` and `verify:auth` claim the single account themselves, so they
**only run against a clean database**. They abort with "A user already exists"
otherwise. That is expected, not a regression.

---

## Standing rules

- **Never** modify Production data, schema or configuration without explicit
  approval in the same conversation.
- **Never** commit credentials. If one is exposed in chat, say so and ask for it
  to be rotated.
- **Never** edit an applied migration. Add a new numbered one.
- **Never** initialise or re-seed Production from Development.
- Keep generated API code in step with the spec: edit `lib/api-spec/openapi.yaml`,
  then run `pnpm --filter @workspace/api-spec run codegen`. Do not hand-edit
  `lib/api-zod` or `lib/api-client-react` output.
- Run `pnpm -r typecheck` and the production build before proposing a release.
- The frontend build needs `PORT` and `BASE_PATH` set, because `vite.config.ts`
  asserts both at config load:
  `PORT=4173 BASE_PATH=/ pnpm --filter @workspace/expense-manager run build`
- The API server runs from `dist/index.mjs`, not in watch mode. After changing
  `artifacts/api-server`, run `pnpm --filter @workspace/api-server run build`
  and restart it.

---

## Prompt templates

### Developing a feature

> Develop this feature in Development only. Do not touch Production.
>
> If database changes are required, create a new numbered migration. Never modify
> previously applied migrations.
>
> Apply and test the migration against Neon Development.
>
> Test the feature and existing functionality.
>
> When complete, report:
> - files changed
> - whether database schema changed
> - migration filename
> - migration safety/risk
> - tests performed
> - whether a Production migration is required
>
> Do not deploy Production until I explicitly approve it.

### Promoting a feature

> Promote this feature to Production.
>
> Verify the exact migration that was tested in Development.
>
> Do not copy Development data to Production.
>
> Apply only the new migration(s) required by this release to Production.
>
> Verify the Production schema and existing data before deploying the application.
>
> Then deploy the tested code to Render/Vercel.
>
> Run production smoke tests after deployment.