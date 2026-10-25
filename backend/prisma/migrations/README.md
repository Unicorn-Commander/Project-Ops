# Database schema: how this repo manages it

Project-Ops is **`prisma db push`-managed**. `schema.prisma` is the source of truth for
tables, columns, enums, indexes and foreign keys. CI, the self-host start
(`backend/src/selfhost/start.ts`) and `scripts/deploy.sh` all use `db push`.

This folder is **not** a from-empty migration history. Some tables (for example
`triage_proposals`) were only ever created by `db push`, so
`prisma migrate deploy` against an EMPTY database fails at
`20260609000000_phase2_tenancy_cols`. Never bring up a new database with
`migrate deploy`.

What the folder holds is the SQL that `db push` cannot express: roles, the GUC
chokepoint, RLS policies, grants, the HIPAA ratchet trigger, and the tenancy seeds. Those
files are guarded and idempotent, so re-applying them is safe.

## New hosted (multi-tenant) database

1. `npx prisma db push --skip-generate` as the owner/superuser.
2. Apply the tenancy SQL by hand, in this order, with `psql -v ON_ERROR_STOP=1 -f`
   (the same list as `backend/tests/integration/rls/run.sh`):
   - `20260603051046_suite_tenancy_rls_roles`: roles, GUC chokepoint, RLS, HIPAA ratchet
   - `20260609000000_phase2_tenancy_cols`
   - `20260609120000_phase2_workspace_seed`
   - `20260610090000_mu_canonical_rekey`
   - `20260617000000_phase3_workspace_not_null`
   - `20260916040000_manual_workspace_invitations`
   - `20261025000000_rls_for_db_push_tables`: RLS for task_dependencies, notifications,
     saved_views, custom_field_definitions, automation_rules, webhook_*, approvals and
     agent_events (their own migrations also CREATE TABLE, which fails after db push)
3. Record the history: `npx prisma migrate resolve --applied <name>` for every folder
   here. `npx prisma migrate status` should then say "Database schema is up to date".

The single-tenant self-host path needs only step 1. `start.ts` creates the app role itself.

## Changing the schema

- Columns, tables and indexes: edit `schema.prisma`, then run `prisma db push`
  **without** `--accept-data-loss`. If a change would drop data, `db push` stops and asks;
  plan that change by hand.
- RLS, grants, triggers, functions: add a new guarded, idempotent migration folder.
  Apply it by hand on each ring, then `migrate resolve --applied` it there.

## Live rings

Prod (centerdeep) and dogfood (bigboy) have had `_prisma_migrations` baselined since
2026-10-25: all 15 folders are recorded, and the schema matches `schema.prisma`
(Project-Ops task 4a1ad0bd). There, `prisma migrate deploy` is a no-op, and a new guarded
migration folder can be applied with it.
