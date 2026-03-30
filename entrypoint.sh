#!/bin/sh
set -e

echo "Running database migrations..."
# bunx prisma db push

echo "Starting application..."
exec bun run index.ts
