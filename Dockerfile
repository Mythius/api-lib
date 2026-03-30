FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build/generate Prisma client
FROM deps AS build
COPY . .
RUN DATABASE_URL=postgresql://placeholder bunx prisma generate

# Production image
FROM base AS runner
COPY --from=build /app .
COPY --from=deps /app/node_modules ./node_modules

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 3000
CMD ["./entrypoint.sh"]
