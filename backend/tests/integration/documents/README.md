# Document proof

Run only against disposable PostgreSQL and S3-compatible storage. Tests create and delete synthetic fixtures. Do not point these environment variables at an application database.

1. Install backend dependencies and run `npx prisma generate`.
2. Start throwaway PostgreSQL17 on localhost55519, database project_ops, owner postgres/pw. Apply `prisma db push`, then the five tenancy migrations listed in `tests/integration/rls/run.sh`. The resulting `project_ops_app` role uses the fixture password verify_app and must be NOBYPASSRLS and non-superuser (asserted by the test).
3. Start throwaway MinIO on localhost55520 with fixture credentials proofuser/proofpassword. The test intentionally uses distinct internal127.0.0.1 and public localhost hosts to prove signing behavior.
4. Run from backend:

```bash
DOCUMENT_PROOF_ADMIN_URL=postgresql://postgres:REMOVED@127.0.0.1:55519/project_ops \
DOCUMENT_PROOF_APP_URL=postgresql://project_ops_app:REMOVED@127.0.0.1:55519/project_ops \
npx jest --config tests/jest-integration.json --runInBand \
  --runTestsByPath tests/integration/documents/documents.integration.test.ts
```

The first test reproduces the original empty-OR query failure and proves real UUID upload/read/update/delete, exact downloaded bytes, cross-workspace ADMIN rejection, unassigned STAFF rejection, assigned STAFF access, CLIENT denial, and deleted object404. The second proves public-host signed PUT/GET byte roundtrip and a deliberately rewritten host403. No production credentials, real documents or identity provider calls are used.

Deployment: backend only, no schema migration for this patch. Build from the current running revision plus this commit and the separately reviewed portal patch. Retain the prior image identifier and compose configuration, use service-only `up -d --no-deps`, and verify existing Markdown UUID read and verified PDF SHA256 before synthetic CRUD. Keep task open until deployed checks pass. Roll back by restoring the recorded backend image and recreating only that service. This reintroduces the old document bugs, so keep client launch gated.

`MINIO_REGION` may override the signing region; default us-east-1 matches the current Garage bucket, verified read-only2026-09-17. The public endpoint must preserve Host through the storage proxy. Keys remain server-side and signed URLs must not be logged.
