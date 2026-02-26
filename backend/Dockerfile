# Multi-stage build for NestJS backend

# Stage 1: Dependencies
FROM node:20-alpine3.19 AS dependencies

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production && \
    npm cache clean --force

# Stage 2: Build
FROM node:20-alpine3.19 AS build

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY src ./src

RUN npm run build && \
    npx prisma generate

# Stage 3: Production
FROM node:20-alpine3.19 AS production

WORKDIR /app

ENV NODE_ENV=production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy dependencies and build
COPY --from=dependencies --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=nestjs:nodejs prisma ./prisma
COPY --chown=nestjs:nodejs package*.json ./

# Create logs directory
RUN mkdir -p logs && chown nestjs:nodejs logs

USER nestjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health/live', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/main.js"]