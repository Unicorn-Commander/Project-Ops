# Project Ops

Project management, task tracking, and operations dashboard by Magic Unicorn.

Part of the [Unicorn Commander](https://unicorncommander.ai) suite.

## Stack

- **Frontend**: Next.js 15, React, Tailwind CSS
- **Backend**: NestJS, Prisma, PostgreSQL 17
- **Auth**: Keycloak (uchub realm) SSO
- **Storage**: MinIO (object storage for documents)
- **Cache**: Redis

## Deployments

| Instance | Domain | Purpose |
|---|---|---|
| MU/UC internal | `projectops.magicunicorn.dev` | Magic Unicorn / Unicorn Commander team work |
| GFL MSP | `projectops.brightwaterlabs.example` | Brightwater Labs MSP client engagements |

Both federate to the same Keycloak `uchub` realm at `auth.unicorncommander.ai`. Each instance has its own Postgres / Redis / MinIO and its own Keycloak client.

## Local development

```bash
# 1. Start infrastructure (Postgres + Redis + MinIO)
cd infrastructure/docker
cp .env.example .env  # then fill in real values
docker compose up -d project-ops-postgres project-ops-redis project-ops-minio

# 2. Backend
cd ../../backend
cp .env.example .env  # then fill in real values
npm install
npx prisma generate
npx prisma db push          # applies prisma/schema.prisma to the DB
npm run start:dev           # http://localhost:3201

# 3. Frontend
cd ../frontend
npm install
npm run dev                 # http://localhost:3200
```

> Production currently uses `prisma db push` (schema is the source of truth, no migration history). If you need migration history, run `npx prisma migrate dev --name <change>` to generate one — but check with the maintainer first to avoid divergence between deployments.

## Production deployment

Each host clones the repo and runs:

```bash
cd infrastructure/docker
cp .env.example .env  # set DOMAIN, API_DOMAIN, secrets, KEYCLOAK_CLIENT_SECRET
docker compose up -d --build
docker exec project-ops-backend npx prisma db push
```

Schema is applied via `prisma db push`. Compose is host-portable — same compose file runs anywhere by changing `${DOMAIN}` / `${API_DOMAIN}` / `${STORAGE_DOMAIN}` and the Keycloak client secret in `.env`.

## SSO

The login page exposes a "Sign in with Unicorn Commander" button that hits the backend `/api/v1/auth/keycloak`, which redirects to the uchub realm and returns the user to `/auth/sso-callback?token=…`. First-time SSO users are JIT-provisioned with a default role determined by `getDefaultRoleForEmail` in `backend/src/auth/auth.service.ts`.

The email + password form on the login page is retained for client-portal users invited via the `/contacts/:id/invite` endpoint — those users don't have Keycloak accounts.
