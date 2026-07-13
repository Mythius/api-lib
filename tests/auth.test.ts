import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import {
  setupPublicRoutes,
  setupMiddleware,
  setupPrivateRoutes,
} from "../tools/auth.ts";

// This suite drives the real auth.json-backed login flow, so it backs up
// whatever is on disk before seeding test users and restores it afterward —
// auth.json is a live dev user store (see CLAUDE.md), not test fixture data.
const AUTH_FILE = "auth.json";
const TEST_USER = "test-suite-user@example.com";
const TEST_ADMIN = "test-suite-admin@example.com";
const TEST_PASSWORD = "correct-password";

function md5(str: string): string {
  return new Bun.CryptoHasher("md5").update(str).digest("hex");
}

let originalAuthContent: string | null = null;

beforeAll(() => {
  originalAuthContent = existsSync(AUTH_FILE) ? readFileSync(AUTH_FILE, "utf-8") : null;
  const seeded = originalAuthContent ? JSON.parse(originalAuthContent) : {};
  seeded[TEST_USER] = { password: md5(TEST_PASSWORD), priv: 0, token: "" };
  seeded[TEST_ADMIN] = { password: md5(TEST_PASSWORD), priv: 1, token: "" };
  writeFileSync(AUTH_FILE, JSON.stringify(seeded));
});

afterAll(async () => {
  const restore = () => {
    if (originalAuthContent !== null) writeFileSync(AUTH_FILE, originalAuthContent);
    else if (existsSync(AUTH_FILE)) unlinkSync(AUTH_FILE);
  };
  const matchesTarget = () =>
    (existsSync(AUTH_FILE) ? readFileSync(AUTH_FILE, "utf-8") : null) === originalAuthContent;
  // auth.ts's saveAuth() fires Bun.write() without awaiting it, so a write
  // triggered by the last test can still land after this restore wins the
  // race. Keep re-asserting the restore until it sticks.
  for (let attempt = 0; attempt < 20 && !matchesTarget(); attempt++) {
    restore();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
});

function buildApp() {
  const app = new Hono();
  setupPublicRoutes(app);
  setupMiddleware(app);
  app.get("/whoami", (c) => c.json({ username: (c as any).get("session")?.username }));
  setupPrivateRoutes(app);
  return app;
}

async function login(app: Hono, username: string, password: string) {
  return app.request("/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

function extractAuthToken(setCookieHeader: string | null): string {
  const match = setCookieHeader?.match(/auth_token=([^;]+)/);
  if (!match) throw new Error("no auth_token cookie in response");
  return match[1]!;
}

describe("auth", () => {
  test("private routes reject requests with no credentials", async () => {
    const res = await buildApp().request("/whoami");
    expect(res.status).toBe(403);
  });

  test("login fails for an unknown user", async () => {
    const res = await login(buildApp(), "nobody@nowhere.invalid", "whatever");
    expect(res.status).toBe(403);
  });

  test("login fails for a wrong password", async () => {
    const res = await login(buildApp(), TEST_USER, "wrong-password");
    expect(res.status).toBe(403);
  });

  test("login succeeds and sets an auth_token cookie", async () => {
    const res = await login(buildApp(), TEST_USER, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("auth_token=");
  });

  test("a valid session cookie grants access to a private route", async () => {
    const app = buildApp();
    const loginRes = await login(app, TEST_USER, TEST_PASSWORD);
    const token = extractAuthToken(loginRes.headers.get("set-cookie"));

    const res = await app.request("/whoami", { headers: { Cookie: `auth_token=${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).username).toBe(TEST_USER);
  });

  test("an Authorization header works as an alternative to the cookie", async () => {
    const app = buildApp();
    const loginRes = await login(app, TEST_USER, TEST_PASSWORD);
    const token = extractAuthToken(loginRes.headers.get("set-cookie"));

    const res = await app.request("/whoami", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  test("logout invalidates the session", async () => {
    const app = buildApp();
    const loginRes = await login(app, TEST_USER, TEST_PASSWORD);
    const token = extractAuthToken(loginRes.headers.get("set-cookie"));

    const logoutRes = await app.request("/auth", {
      method: "DELETE",
      headers: { Cookie: `auth_token=${token}` },
    });
    expect(logoutRes.status).toBe(200);

    const res = await app.request("/whoami", { headers: { Cookie: `auth_token=${token}` } });
    expect(res.status).toBe(403);
  });

  test("/newuser rejects a non-admin session", async () => {
    const app = buildApp();
    const loginRes = await login(app, TEST_USER, TEST_PASSWORD);
    const token = extractAuthToken(loginRes.headers.get("set-cookie"));

    const res = await app.request("/newuser", {
      method: "POST",
      headers: { Cookie: `auth_token=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "wont-be-created", password: "x" }),
    });
    expect(res.status).toBe(403);
  });

  test("/newuser allows an admin session to create a user", async () => {
    const app = buildApp();
    const loginRes = await login(app, TEST_ADMIN, TEST_PASSWORD);
    const token = extractAuthToken(loginRes.headers.get("set-cookie"));

    const res = await app.request("/newuser", {
      method: "POST",
      headers: { Cookie: `auth_token=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "created-by-test-suite", password: "x", priv: 0 }),
    });
    expect(res.status).toBe(200);
  });
});
