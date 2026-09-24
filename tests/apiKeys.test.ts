import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import { setupMiddleware, setOnApiKeyLogin, type Session } from "../tools/auth.ts";
import {
  API_KEY_PREFIX,
  apiKeysEnabled,
  createApiKey,
  defaultApiKeyAuthorizer,
  rotateApiKey,
  setApiKeyAuthorizer,
  setApiKeyDelegate,
  verifyApiKey,
  type ApiKeyDelegate,
  type ApiKeyRecord,
} from "../tools/apiKeys.ts";

// In-memory stand-in for prisma.apiKey — enough of the query shapes
// tools/apiKeys.ts actually sends, so these tests never need a database.
function makeFakeDelegate() {
  const rows: ApiKeyRecord[] = [];
  let nextId = 1;
  const d: ApiKeyDelegate = {
    async findUnique({ where }: any) {
      return rows.find((r) => r.hashedKey === where.hashedKey) ?? null;
    },
    async findFirst({ where }: any) {
      const [byId, byPrefix] = where.OR;
      return rows.find((r) => r.id === byId.id || r.prefix.startsWith(byPrefix.prefix.startsWith)) ?? null;
    },
    async findMany() {
      return [...rows];
    },
    async create({ data }: any) {
      const row = { id: String(nextId++), createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  };
  return { d, rows };
}

function buildApp() {
  const app = new Hono();
  setupMiddleware(app);
  app.get("/whoami", (c) => c.json((c as any).get("session") as Session));
  app.post("/things", (c) => c.json({ ok: true }));
  app.post("/api/thing/filter", (c) => c.json([]));
  return app;
}

function bearer(raw: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { Authorization: `Bearer ${raw}` } };
}

let fake: ReturnType<typeof makeFakeDelegate>;
beforeEach(() => {
  fake = makeFakeDelegate();
  setApiKeyDelegate(fake.d);
  setApiKeyAuthorizer(defaultApiKeyAuthorizer);
  setOnApiKeyLogin(async () => {});
});
afterAll(() => {
  setApiKeyDelegate(null);
});

describe("API keys", () => {
  test("createApiKey stores only a hash plus a short display prefix", async () => {
    const { raw, record } = await createApiKey("job", "READ_ONLY");
    expect(raw.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(record.hashedKey).not.toContain(raw);
    expect(raw.startsWith(record.prefix)).toBe(true);
    expect(record.prefix.length).toBeLessThan(raw.length);
  });

  test("a valid key authenticates and populates session.apiKey", async () => {
    const { raw, record } = await createApiKey("job", "ALL");
    const res = await buildApp().request("/whoami", bearer(raw));
    expect(res.status).toBe(200);
    const session = await res.json();
    expect(session.apiKey).toEqual({ id: record.id, label: "job", role: "ALL" });
    expect(session.user.priv).toBe(1);
  });

  test("an unknown or revoked key is rejected", async () => {
    const app = buildApp();
    expect((await app.request("/whoami", bearer(API_KEY_PREFIX + "nope"))).status).toBe(403);
    const { raw, record } = await createApiKey("job", "ALL");
    record.revokedAt = new Date();
    expect((await app.request("/whoami", bearer(raw))).status).toBe(403);
  });

  test("READ_ONLY keys can read (including /filter) but not write", async () => {
    const { raw } = await createApiKey("job", "READ_ONLY");
    const app = buildApp();
    expect((await app.request("/whoami", bearer(raw))).status).toBe(200);
    expect((await app.request("/api/thing/filter", bearer(raw, { method: "POST" }))).status).toBe(200);
    expect((await app.request("/things", bearer(raw, { method: "POST" }))).status).toBe(403);
  });

  test("roles the default policy doesn't know are denied", async () => {
    const { raw } = await createApiKey("job", "SOMETHING_NEW");
    expect((await buildApp().request("/whoami", bearer(raw))).status).toBe(403);
  });

  test("setApiKeyAuthorizer replaces the policy", async () => {
    setApiKeyAuthorizer((key, c) => key.role === "SOMETHING_NEW" && c.req.path === "/things");
    const { raw } = await createApiKey("job", "SOMETHING_NEW");
    const app = buildApp();
    expect((await app.request("/things", bearer(raw, { method: "POST" }))).status).toBe(200);
    expect((await app.request("/whoami", bearer(raw))).status).toBe(403);
  });

  test("setOnApiKeyLogin can attach project data to the session", async () => {
    setOnApiKeyLogin(async (session, key) => {
      session.db = { ownerId: key.ownerId };
    });
    const { raw } = await createApiKey("job", "ALL", { ownerId: "u1" });
    const session = await (await buildApp().request("/whoami", bearer(raw))).json();
    expect(session.db).toEqual({ ownerId: "u1" });
  });

  test("rotateApiKey revokes the old key and carries over chosen columns", async () => {
    const { raw: oldRaw, record } = await createApiKey("job", "ALL", { ownerId: "u1" });
    const { raw: newRaw, record: fresh } = await rotateApiKey(record, ["ownerId"]);
    expect(await verifyApiKey(oldRaw)).toBeNull();
    expect((await verifyApiKey(newRaw))?.id).toBe(fresh.id);
    expect(fresh).toMatchObject({ label: "job", role: "ALL", ownerId: "u1" });
  });

  test("with no ApiKey model, keys are off and key-shaped tokens fall through to sessions", async () => {
    setApiKeyDelegate(null);
    expect(await apiKeysEnabled()).toBe(false);
    expect(await verifyApiKey(API_KEY_PREFIX + "x")).toBeNull();
    await expect(createApiKey("job", "ALL")).rejects.toThrow("not enabled");
    const res = await buildApp().request("/whoami", bearer(API_KEY_PREFIX + "x"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid Token" });
  });
});
