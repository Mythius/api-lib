import { describe, test, expect } from "bun:test";

// Importing index.ts pulls in api.ts -> tools/prisma.ts, which requires
// DATABASE_URL to be a parseable URL at import time. It only builds a
// lazy pg.Pool, so no real database connection is needed for these tests.
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test_db";

const { default: server } = await import("../index.ts");

describe("index.ts wiring", () => {
  test("GET /health returns ok", async () => {
    const res = await server.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /hello is reachable without a session", async () => {
    const res = await server.fetch(new Request("http://localhost/hello"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Hello World" });
  });

  test("POST /json echoes the request body", async () => {
    const res = await server.fetch(
      new Request("http://localhost/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hi: "there" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: { hi: "there" } });
  });

  test("GET /user is gated by the auth middleware", async () => {
    const res = await server.fetch(new Request("http://localhost/user"));
    expect(res.status).toBe(403);
  });

  // "/api/_schema" is always mounted by exposePrismaCRUD regardless of which
  // models the project defines — deliberately not asserting on model names
  // here, since a forked project is expected to replace the demo schema.
  test("auto-mounted Prisma CRUD routes are gated by the auth middleware", async () => {
    const res = await server.fetch(new Request("http://localhost/api/_schema"));
    expect(res.status).toBe(403);
  });

  test("GET /endpoints/json reflects both hand-written and auto-generated routes", async () => {
    const res = await server.fetch(new Request("http://localhost/endpoints/json"));
    const paths = (await res.json()).map((r: { path: string }) => r.path);
    expect(paths).toEqual(expect.arrayContaining(["/health", "/hello", "/user", "/api/_schema"]));
  });

  test("any per-model CRUD routes discovered are also gated by the auth middleware", async () => {
    // Discovers whatever models the current schema happens to define instead
    // of hardcoding one, so this keeps working after the schema is replaced.
    const endpoints = await server.fetch(new Request("http://localhost/endpoints/json"));
    const paths: string[] = (await endpoints.json()).map((r: { path: string }) => r.path);
    const modelListRoute = paths.find((p) => /^\/api\/[^/_][^/]*$/.test(p));
    if (!modelListRoute) return; // no models defined yet — nothing to check

    const res = await server.fetch(new Request(`http://localhost${modelListRoute}`));
    expect(res.status).toBe(403);
  });

  test("unknown routes fall through to the auth middleware and are rejected as unauthenticated", async () => {
    // The catch-all auth middleware runs for every path registered after it,
    // matched or not — so an unknown path returns 403, not 404.
    const res = await server.fetch(new Request("http://localhost/definitely-not-a-route"));
    expect(res.status).toBe(403);
  });
});
