# Manual invitation verification

The default suite starts real Nest controllers with the production JWT and
workspace guards, backed by PostgreSQL using the non-superuser,
non-BYPASSRLS `project_ops_app` role. Only fixture setup/cleanup and intentional
failure/lock injection use the separate database owner connection.

Prepare a disposable database with the Prisma schema, existing tenancy migrations,
and `20260916040000_manual_workspace_invitations/migration.sql`. Set
`INVITATION_ADMIN_DATABASE_URL` and `INVITATION_APP_DATABASE_URL`, then run:

```sh
npx jest --config tests/jest-integration.json --runInBand \
  --runTestsByPath tests/integration/invitations/workspace-invitations.integration.test.ts
```

CI runs this command after the existing RLS proof. Never point these variables at
an application database: tests create/delete fixtures and inject a temporary
failure trigger. Do not run two copies concurrently against the same database.

## Optional browser proof

Run the real frontend on `127.0.0.1:55488` with
`NEXT_PUBLIC_API_URL=http://127.0.0.1:55487/api/v1`. Set
`INVITATION_BROWSER_URL=http://127.0.0.1:55488` on the command above. Python
Playwright and Chrome must be installed. The optional test listens on 55487,
uses signed synthetic fixture sessions supplied to Python over stdin, and
exercises the actual owner settings and zero-membership acceptance pages.
No external SSO, email or application service is contacted.

The proof verifies copy-token behavior, mobile layout, body-only acceptance,
absence of invitation capabilities from URLs/browser storage, and actual database
membership. Screenshots go to `/tmp/project-invite-browser`. This is an isolated
user-interface proof, not evidence that a real owner has invited the demo users.
Other settings widgets are outside this narrow test server's route surface.

## Migration and rollback

The migration supports both an existing database and the repository's `db push`
CI setup. Its SQL-only partial uniqueness/check constraints and runtime grants
must be applied after `db push`. Restore the old backend before `rollback.sql`;
that rollback drops pending invitation history and therefore requires a protected
backup. Existing users and accepted memberships are retained. A full disposable
database backup/restore rehearsal is recorded in the closeout evidence.
