import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import {
  createCRUD,
  parseSchema,
  handlePrismaError,
  type PrismaDelegate,
} from "../tools/createCRUD.ts";

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  if ("AND" in where) return (where.AND as any[]).every((w) => matchesWhere(row, w));
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function makeFakeModel(seed: any[] = []) {
  let rows = seed.map((r) => ({ ...r }));
  let nextId = rows.length + 1;
  const model: PrismaDelegate = {
    async findMany(args: any = {}) {
      let result = rows.filter((r) => matchesWhere(r, args.where));
      if (typeof args.skip === "number") result = result.slice(args.skip);
      if (typeof args.take === "number") result = result.slice(0, args.take);
      return result;
    },
    async findFirst(args: any) {
      return rows.find((r) => matchesWhere(r, args?.where)) ?? null;
    },
    async findUnique(args: any) {
      return rows.find((r) => matchesWhere(r, args.where)) ?? null;
    },
    async create({ data }: any) {
      const item = { id: String(nextId++), ...data };
      rows.push(item);
      return item;
    },
    async update({ where, data }: any) {
      const item = rows.find((r) => matchesWhere(r, where));
      if (!item) {
        const err: any = new Error("not found");
        err.code = "P2025";
        throw err;
      }
      Object.assign(item, data);
      return item;
    },
    async delete({ where }: any) {
      const idx = rows.findIndex((r) => matchesWhere(r, where));
      if (idx < 0) {
        const err: any = new Error("not found");
        err.code = "P2025";
        throw err;
      }
      return rows.splice(idx, 1)[0];
    },
    async deleteMany({ where }: any) {
      const before = rows.length;
      rows = rows.filter((r) => !matchesWhere(r, where));
      return { count: before - rows.length };
    },
  };
  return model;
}

function mountCRUD(
  model: PrismaDelegate,
  opts: {
    checkPermissions?: Parameters<typeof createCRUD>[4];
    validateData?: Parameters<typeof createCRUD>[5];
  } = {},
) {
  const app = new Hono();
  createCRUD(app, "items", model, "id", opts.checkPermissions, opts.validateData);
  return app;
}

describe("createCRUD", () => {
  test("GET list returns all rows", async () => {
    const app = mountCRUD(makeFakeModel([{ id: "1", name: "a" }, { id: "2", name: "b" }]));
    const res = await app.request("/items");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
  });

  test("GET by id returns 404 when missing", async () => {
    const app = mountCRUD(makeFakeModel());
    const res = await app.request("/items/missing");
    expect(res.status).toBe(404);
  });

  test("GET by id returns the matching row", async () => {
    const app = mountCRUD(makeFakeModel([{ id: "1", name: "a" }]));
    const res = await app.request("/items/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "a" });
  });

  test("paginated list applies skip/take", async () => {
    const seed = Array.from({ length: 5 }, (_, i) => ({ id: String(i + 1), name: `n${i + 1}` }));
    const app = mountCRUD(makeFakeModel(seed));
    const res = await app.request("/items/page/2/2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "3", name: "n3" },
      { id: "4", name: "n4" },
    ]);
  });

  test("POST /filter queries by request body", async () => {
    const app = mountCRUD(
      makeFakeModel([{ id: "1", name: "a" }, { id: "2", name: "b" }]),
    );
    const res = await app.request("/items/filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "b" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "2", name: "b" }]);
  });

  test("POST creates a row and strips system fields from the input", async () => {
    const app = mountCRUD(makeFakeModel());
    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "should-be-ignored", name: "new item" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("new item");
    expect(body.id).not.toBe("should-be-ignored");
  });

  test("PUT updates an existing row", async () => {
    const app = mountCRUD(makeFakeModel([{ id: "1", name: "old" }]));
    const res = await app.request("/items/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "updated" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "updated" });
  });

  test("DELETE removes a row", async () => {
    const app = mountCRUD(makeFakeModel([{ id: "1", name: "a" }]));
    const res = await app.request("/items/1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await (await app.request("/items/1")).status).toBe(404);
  });

  test("checkPermissions can deny a request", async () => {
    const app = mountCRUD(makeFakeModel([{ id: "1", name: "a" }]), {
      checkPermissions: () => ({ allowed: false }),
    });
    const res = await app.request("/items");
    expect(res.status).toBe(403);
  });

  test("rowLevelFilter is merged into created rows", async () => {
    const app = mountCRUD(makeFakeModel(), {
      checkPermissions: () => ({ allowed: true, rowLevelFilter: { ownerId: "u1" } }),
    });
    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "mine" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ownerId: "u1" });
  });

  test("rowLevelFilter rejects a create that conflicts with it", async () => {
    const app = mountCRUD(makeFakeModel(), {
      checkPermissions: () => ({ allowed: true, rowLevelFilter: { ownerId: "u1" } }),
    });
    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "mine", ownerId: "someone-else" }),
    });
    expect(res.status).toBe(403);
  });

  test("rowLevelFilter hides rows owned by someone else on update", async () => {
    const app = mountCRUD(makeFakeModel([{ id: "1", name: "a", ownerId: "someone-else" }]), {
      checkPermissions: () => ({ allowed: true, rowLevelFilter: { ownerId: "u1" } }),
    });
    const res = await app.request("/items/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hijacked" }),
    });
    expect(res.status).toBe(404);
  });

  test("validateData can reject a write with a custom message", async () => {
    const app = mountCRUD(makeFakeModel(), {
      validateData: () => "name is required",
    });
    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "name is required" });
  });

  test("malformed JSON body returns 400 instead of 500", async () => {
    const app = mountCRUD(makeFakeModel());
    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("handlePrismaError", () => {
  function stub() {
    const calls: Array<{ body: unknown; status?: number }> = [];
    const c = { json: (body: unknown, status?: number) => (calls.push({ body, status }), { body, status }) };
    return { c: c as any, calls };
  }

  const cases: Array<[string, number]> = [
    ["P2025", 404],
    ["P2002", 409],
    ["P2003", 400],
    ["P2000", 400],
    ["P9999", 500],
  ];

  for (const [code, expectedStatus] of cases) {
    test(`maps Prisma error code ${code} to HTTP ${expectedStatus}`, () => {
      const { c, calls } = stub();
      const err: any = new Error("boom");
      err.code = code;
      handlePrismaError(c, err);
      expect(calls[0]!.status).toBe(expectedStatus);
    });
  }

  test("maps a non-Prisma error to a 500", () => {
    const { c, calls } = stub();
    handlePrismaError(c, "not even an Error instance");
    expect(calls[0]!.status).toBe(500);
  });
});

describe("parseSchema", () => {
  // Uses a fixture schema rather than the project's real prisma/schema.prisma
  // — this template's models are expected to be swapped out entirely by
  // whoever forks it, so the parser tests shouldn't depend on their names.
  const schema = parseSchema("./tests/fixtures/sample-schema.prisma");

  test("detects the primary key for each model", () => {
    expect(schema.author!.primaryKey).toBe("id");
    expect(schema.book!.primaryKey).toBe("id");
  });

  test("detects foreign keys and their referenced model/field", () => {
    expect(schema.book!.foreignKeys.authorId).toEqual({
      referencedModel: "author",
      referencedField: "id",
    });
  });

  test("collects scalar fields but excludes relation arrays", () => {
    expect(schema.author!.fields).toEqual(expect.arrayContaining(["id", "name"]));
    expect(schema.author!.fields).not.toContain("books");
  });
});
