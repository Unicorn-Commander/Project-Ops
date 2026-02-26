# Project Ops

Project management, task tracking, and operations dashboard by Magic Unicorn.

Part of the [Unicorn Commander](https://unicorncommander.ai) suite.

## Stack

- **Frontend**: Next.js 15, React, Tailwind CSS
- **Backend**: NestJS, Prisma, PostgreSQL
- **Auth**: Keycloak (uchub realm) SSO
- **Storage**: MinIO
- **Cache**: Redis

## Development

```bash
# Start infrastructure
cd infrastructure/docker && docker compose up -d

# Backend
cd backend && npm install && npx prisma migrate deploy && npx prisma db seed && npm run start:dev

# Frontend
cd frontend && npm install && npm run dev
```

## Deployment

```bash
./scripts/deploy.sh
```

## URLs

- Frontend: https://projectops.unicorncommander.ai
- API: https://api.projectops.unicorncommander.ai
- Storage: https://storage.projectops.unicorncommander.ai
