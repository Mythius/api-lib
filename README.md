# api-lib

A **boilerplate/template** for building API projects — a batteries-included Bun + [Hono](https://hono.dev) backend with authentication, session management, and auto-generated CRUD routes over Prisma already wired up. Clone it and start building your own API on top of it, rather than starting from scratch.

## Features

- **Multi-provider authentication** — local username/password, Google OAuth, Microsoft OAuth, and optional delegation to an external CAS server, all unified into a single session model.
- **Pluggable sessions** — in-memory by default, or Redis-backed for multi-instance/production use.
- **Auto-generated REST CRUD** — every model in your `prisma/schema.prisma` automatically gets list/get/paginate/filter/create/update/delete routes, with hooks for per-route permissions and row-level filtering.
- **Works with Postgres, MySQL, or MariaDB** — picked automatically from your `DATABASE_URL`.
- **File uploads** and **email sending** (Gmail or Linux `sendmail`) helpers included.
- **Docker-ready** — `docker-compose.yml` runs the app alongside Postgres and Redis.
- **Route introspection** at `/endpoints/html` and `/endpoints/json` for a live view of everything registered.
- A small dependency-free vanilla-JS demo frontend and UI component library under `public/`.

## Getting started

1. Install dependencies:
   ```
   bun install
   ```
2. Copy `example-env` to `.env` and fill in the values you need (at minimum `DATABASE_URL`). See [CLAUDE.md](CLAUDE.md#environment-variables) for the full list of supported variables.
3. Generate the Prisma client and push the schema to your database:
   ```
   bunx prisma generate
   bunx prisma db push
   ```
4. Run the server:
   ```
   bun start
   ```
   The server listens on `PORT` (default `3000`).

Alternatively, run everything (app + Postgres + Redis) with Docker:
```
docker-compose up --build
```

## Building on this template

- Add your own routes in [api.ts](api.ts) — `publicRoutes()` for unauthenticated endpoints, `privateRoutes()` for endpoints that require a logged-in session.
- Define your data model in [prisma/schema.prisma](prisma/schema.prisma) — each model automatically gets a full CRUD API mounted at `/api/<model>`.
- Everything under [tools/](tools/) (auth, session store, CRUD generator, file upload, mail, Google API helpers) is meant to stay generic — treat it as the reusable "library" layer of the template rather than something to edit per-project.

## Project structure

```
index.ts        Server entrypoint — wires up static files, auth, and API routes
api.ts          Your project's routes and business logic (edit this)
prisma/         Your data model (prisma/schema.prisma)
tools/          Reusable library internals: auth, sessions, CRUD generator, uploads, mail, Google API
public/         Demo frontend + vanilla-JS UI component library
Dockerfile,
docker-compose.yml,
entrypoint.sh   Container build and local multi-service deployment
```

For a deeper architectural walkthrough (intended for AI assistants working in this repo, but useful for humans too), see [CLAUDE.md](CLAUDE.md).
