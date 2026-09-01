import { Hono } from "hono";
import { readFileSync } from "fs";
import { Context } from "hono";

// Set DEBUG_CRUD=1 in your .env to enable per-request permission/validation logging.
const DEBUG_CRUD = process.env.DEBUG_CRUD === "1";

function crudLog(
  event: "PERMISSION_DENIED" | "VALIDATION_FAILED",
  action: string,
  c: Context,
  extra?: Record<string, unknown>,
) {
  if (!DEBUG_CRUD) return;
  const session = (c as any).get?.("session");
  const user = session?.db
    ? { id: session.db.id, role: session.db.role, orgId: session.db.organizationId }
    : null;
  console.log(`[CRUD:${event}]`, {
    action,
    url: c.req.url,
    method: c.req.method,
    user,
    ...extra,
  });
}

export interface PrismaDelegate {
  findMany(args?: object): Promise<unknown[]>;
  findFirst(args?: object): Promise<unknown | null>;
  create(args: { data: unknown }): Promise<unknown>;
  findUnique(args: { where: object }): Promise<unknown | null>;
  update(args: { where: object; data: unknown }): Promise<unknown>;
  updateMany(args: { where: object; data: unknown }): Promise<{ count: number }>;
  delete(args: { where: object }): Promise<unknown>;
  deleteMany(args: { where: object }): Promise<{ count: number }>;
}

export type PermissionResult = {
  allowed: boolean;
  rowLevelFilter?: Record<string, unknown>;
};

function normalizePermission(
  result: PermissionResult | boolean,
): PermissionResult {
  return typeof result === "boolean" ? { allowed: result } : result;
}

export interface SchemaModelInfo {
  primaryKey: string;
  fields: string[];
  fieldTypes: Record<string, string>;
  foreignKeys: Record<
    string,
    { referencedModel: string; referencedField: string }
  >;
}

// Maps Prisma error codes to HTTP responses
export function handlePrismaError(c: any, error: unknown) {
  if (error instanceof Error && "code" in error) {
    const { code } = error as { code: string };
    switch (code) {
      case "P2025":
        return c.json({ error: "Record not found" }, 404);
      case "P2002":
        return c.json(
          { error: "A record with that value already exists" },
          409,
        );
      case "P2003":
        return c.json({ error: "Foreign key constraint failed" }, 400);
      case "P2000":
        return c.json({ error: "Value too long for column" }, 400);
      default:
        console.error(`Prisma error [${code}]:`, error);
        return c.json({ error: "Database error" }, 500);
    }
  }
  console.error("Unexpected error:", error);
  return c.json({ error: "Internal server error" }, 500);
}

const SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function stripSystemFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!SYSTEM_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

function parseId(param: string): string | number | null {
  if (!param) return null;
  const n = parseInt(param, 10);
  // Return integer only when the whole string is a valid integer
  return !isNaN(n) && String(n) === param ? n : param;
}

// Optional ?sort=field&dir=asc|desc query params, shared by the page and
// filter routes — a bad field name just surfaces as a Prisma error via
// handlePrismaError rather than needing validation against the schema here.
// Supports one level of to-one relation sort via a dotted field name (e.g.
// `?sort=beneficiary.name` -> `{ beneficiary: { name: dir } }`), needed by the
// campaign beneficiary picker (sorting BeneficiaryProgram rows by the related
// Beneficiary's name) — Prisma only supports orderBy through a relation for
// to-one relations, not to-many, so this deliberately doesn't recurse further.
function parseSortParam(c: Context): Record<string, unknown> | null {
  const sort = c.req.query("sort");
  if (!sort) return null;
  const dir = c.req.query("dir") === "desc" ? "desc" : "asc";
  const dotIndex = sort.indexOf(".");
  if (dotIndex === -1) return { [sort]: dir };
  const relation = sort.slice(0, dotIndex);
  const field = sort.slice(dotIndex + 1);
  return { [relation]: { [field]: dir } };
}

// Combines a pk-equality filter with a rowLevelFilter via AND rather than
// object-spreading them together — spreading silently drops the pk condition
// whenever rowLevelFilter happens to use the same key (e.g. Organization's
// rowLevelFilter is keyed on "id", same as its own pkField), which would let
// the row-level scope override the id being looked up instead of narrowing it.
function scopedWhere(
  pkField: string,
  id: string | number,
  rowLevelFilter?: Record<string, unknown>,
): Record<string, unknown> {
  if (!rowLevelFilter) return { [pkField]: id };
  return { AND: [{ [pkField]: id }, rowLevelFilter] };
}

// Combines an optional where-clause with a default "hide rows where `field`
// is true" filter via AND. Callers that explicitly ask for `field` in their
// own where-body (e.g. a future trash view) or pass `?<queryParam>=true` are
// respected and skip the default filter instead of having it silently
// override their intent. Parameterized so a project can reuse it for its own
// hide-flag beyond the isDeleted/soft-delete wiring below.
function withDefaultHideFlag(
  hasFlag: boolean,
  field: string,
  queryParam: string,
  c: Context,
  where?: Record<string, unknown>,
  skipDefault = false,
): Record<string, unknown> | undefined {
  if (!hasFlag) return where;
  if (skipDefault || c.req.query(queryParam) === "true") return where;
  const notFlagged = { [field]: false };
  if (!where) return notFlagged;
  return { AND: [where, notFlagged] };
}

function withDefaultNotDeleted(
  hasSoftDelete: boolean,
  c: Context,
  where?: Record<string, unknown>,
  skipDefault = false,
): Record<string, unknown> | undefined {
  return withDefaultHideFlag(hasSoftDelete, "isDeleted", "includeDeleted", c, where, skipDefault);
}

export function parseSchema(
  schemaPath = "./prisma/schema.prisma",
): Record<string, SchemaModelInfo> {
  const schemaText = readFileSync(schemaPath, "utf-8");
  const result: Record<string, SchemaModelInfo> = {};

  const modelRegex = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = modelRegex.exec(schemaText)) !== null) {
    const modelName = match[1]!;
    const body = match[2]!;
    const fields: string[] = [];
    const fieldTypes: Record<string, string> = {};
    const foreignKeys: Record<
      string,
      { referencedModel: string; referencedField: string }
    > = {};
    let primaryKey = "id";

    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@"))
        continue;

      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\?|\[\])?(\s|$)/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1]!;
      const fieldType = fieldMatch[2]!;
      const isArray = fieldMatch[3] === "[]";

      if (trimmed.includes("@id")) {
        primaryKey = fieldName;
      }

      const relMatch = trimmed.match(
        /@relation\(.*?fields:\s*\[(\w+)\].*?references:\s*\[(\w+)\]/,
      );
      if (relMatch) {
        const fkColumn = relMatch[1]!;
        const refField = relMatch[2]!;
        foreignKeys[fkColumn] = {
          referencedModel:
            fieldType.charAt(0).toLowerCase() + fieldType.slice(1),
          referencedField: refField,
        };
      } else if (!isArray && !trimmed.includes("@relation")) {
        fields.push(fieldName);
        fieldTypes[fieldName] = fieldType;
      }
    }

    const prismaKey = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    result[prismaKey] = { primaryKey, fields, fieldTypes, foreignKeys };
  }

  return result;
}

export type MutationLogEntry = {
  action: "create" | "update" | "delete";
  recordId: any;
  data: any;
  userEmail?: string;
  orgId?: number | null;
};

export function createCRUD(
  app: Hono,
  path: string,
  model: PrismaDelegate,
  pkField: string,
  checkPermissions: (
    action: string,
    c: Context,
  ) =>
    | PermissionResult
    | boolean
    | Promise<PermissionResult | boolean> = () => ({ allowed: true }),
  validateData: (
    c: Context,
    path: string,
    action: string,
    data: any,
  ) => string | null | Promise<string | null> = () => null,
  logMutation?: (entry: MutationLogEntry) => Promise<void>,
  hasSoftDelete = false,
) {
  async function permit(action: string, c: Context): Promise<PermissionResult> {
    return normalizePermission(await checkPermissions(action, c));
  }

  // skipDeletedDefault lets the /filter route respect a caller who explicitly
  // put `isDeleted` in their own where-body instead of having the default
  // "hide deleted rows" filter silently override their intent.
  function withDefaults(
    c: Context,
    where?: Record<string, unknown>,
    skipDeletedDefault = false,
  ): Record<string, unknown> | undefined {
    return withDefaultNotDeleted(hasSoftDelete, c, where, skipDeletedDefault);
  }

  app.get(path, async (c) => {
    const action = "GET:" + path;
    const perm = await permit(action, c);
    if (!perm.allowed) { crudLog("PERMISSION_DENIED", action, c); return c.json({ error: "Forbidden" }, 403); }
    try {
      const where = withDefaults(c, perm.rowLevelFilter);
      const items = await model.findMany(where ? { where } : undefined);
      return c.json(items);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.get(`${path}/:id`, async (c) => {
    const action = "GET:" + path;
    const perm = await permit(action, c);
    if (!perm.allowed) { crudLog("PERMISSION_DENIED", action, c, { id: c.req.param("id") }); return c.json({ error: "Forbidden" }, 403); }
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    try {
      const where = scopedWhere(pkField, id, perm.rowLevelFilter);
      const item = perm.rowLevelFilter
        ? await model.findFirst({ where })
        : await model.findUnique({ where });
      if (!item) return c.json({ error: "Not found" }, 404);
      return c.json(item);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.get(path + "/page/:page/:pageSize", async (c) => {
    const action = "GET:" + path;
    const perm = await permit(action, c);
    if (!perm.allowed) { crudLog("PERMISSION_DENIED", action, c); return c.json({ error: "Forbidden" }, 403); }
    const page = parseInt(c.req.param("page") || "1") ?? 1;
    const pageSize = parseInt(c.req.param("pageSize") || "10") ?? 10;
    try {
      const where = withDefaults(c, perm.rowLevelFilter);
      const items = await model.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Without an explicit order, skip/take pagination isn't stable across
        // requests (Postgres makes no row-order guarantee) — rows can repeat
        // or go missing between pages as concurrent writes happen. A caller-
        // requested sort field takes priority; pk asc is still the tiebreaker
        // fallback so pagination stays stable when no sort is requested.
        orderBy: parseSortParam(c) ?? { [pkField]: "asc" },
        ...(where ? { where } : {}),
      });
      return c.json(items);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.post(path + "/filter", async (c) => {
    const action = "GET:" + path;
    const perm = await permit(action, c);
    if (!perm.allowed) { crudLog("PERMISSION_DENIED", action + " (filter)", c); return c.json({ error: "Forbidden" }, 403); }
    try {
      const body = await c.req.json();
      const combined = perm.rowLevelFilter
        ? { AND: [body, perm.rowLevelFilter] }
        : body;
      const isPlainObject = body && typeof body === "object";
      const where = withDefaults(c, combined, isPlainObject && "isDeleted" in body);

      // Optional skip/take via query params — additive, so existing callers
      // that only ever send a where-clause body keep their current unbounded
      // behavior. When `take` is present we fetch one extra row (and force a
      // stable pk order) so callers can detect a next page without a COUNT.
      const skipParam = c.req.query("skip");
      const takeParam = c.req.query("take");
      const skip = skipParam !== undefined ? parseInt(skipParam, 10) : NaN;
      const take = takeParam !== undefined ? parseInt(takeParam, 10) : NaN;
      const sort = parseSortParam(c);

      const findArgs: Record<string, unknown> = { where };
      if (!isNaN(skip)) findArgs["skip"] = skip;
      if (!isNaN(take)) {
        findArgs["take"] = take + 1;
        findArgs["orderBy"] = sort ?? { [pkField]: "asc" };
      } else if (sort) {
        findArgs["orderBy"] = sort;
      }

      const items = await model.findMany(findArgs);
      return c.json(items);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return handlePrismaError(c, error);
    }
  });

  app.post(path, async (c) => {
    const action = "POST:" + path;
    const perm = await permit(action, c);
    if (!perm.allowed) { crudLog("PERMISSION_DENIED", action, c); return c.json({ error: "Forbidden" }, 403); }
    try {
      const body = await c.req.json();
      const validErr = await validateData(c, path, action, body);
      if (validErr) { crudLog("VALIDATION_FAILED", action, c, { error: validErr, body }); return c.json({ error: validErr }, 403); }
      if (perm.rowLevelFilter) {
        for (const [key, val] of Object.entries(perm.rowLevelFilter)) {
          if (key in body && body[key] !== val)
            return c.json({ error: "Forbidden" }, 403);
        }
        Object.assign(body, perm.rowLevelFilter);
      }
      const item = await model.create({ data: stripSystemFields(body) });
      await logMutation?.({ action: "create", recordId: (item as any)[pkField], data: item, userEmail: (c as any).get("session")?.email, orgId: (c as any).get("session")?.db?.orgId ?? null }).catch(console.error);
      return c.json(item, 201);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return handlePrismaError(c, error);
    }
  });

  app.put(`${path}/:id`, async (c) => {
    const action = "PUT:" + path;
    const perm = await permit(action, c);
    if (!perm.allowed) { crudLog("PERMISSION_DENIED", action, c, { id: c.req.param("id") }); return c.json({ error: "Forbidden" }, 403); }
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    try {
      const body = await c.req.json();
      const clientUpdatedAt: string | undefined = body.updatedAt;
      const validErr = await validateData(c, path, action, body);
      if (validErr) { crudLog("VALIDATION_FAILED", action, c, { id, error: validErr, body }); return c.json({ error: validErr }, 403); }
      if (perm.rowLevelFilter) {
        const owned = await model.findFirst({
          where: scopedWhere(pkField, id, perm.rowLevelFilter),
        }) as Record<string, unknown> | null;
        if (!owned) return c.json({ error: "Not found" }, 404);
        if (clientUpdatedAt && owned.updatedAt) {
          const serverMs = (owned.updatedAt as Date).getTime();
          const clientMs = new Date(clientUpdatedAt).getTime();
          if (serverMs !== clientMs) return c.json({ error: "conflict", serverUpdatedAt: owned.updatedAt }, 412);
        }
      } else if (clientUpdatedAt) {
        const current = await model.findFirst({ where: { [pkField]: id } }) as Record<string, unknown> | null;
        if (current?.updatedAt) {
          const serverMs = (current.updatedAt as Date).getTime();
          const clientMs = new Date(clientUpdatedAt).getTime();
          if (serverMs !== clientMs) return c.json({ error: "conflict", serverUpdatedAt: current.updatedAt }, 412);
        }
      }
      const item = await model.update({ where: { [pkField]: id }, data: stripSystemFields(body) });
      await logMutation?.({ action: "update", recordId: id, data: stripSystemFields(body), userEmail: (c as any).get("session")?.email, orgId: (c as any).get("session")?.db?.orgId ?? null }).catch(console.error);
      return c.json(item);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return handlePrismaError(c, error);
    }
  });

  app.delete(`${path}/:id`, async (c) => {
    const action = "DELETE:" + path;
    const perm = await permit(action, c);
    if (!perm.allowed) { crudLog("PERMISSION_DENIED", action, c, { id: c.req.param("id") }); return c.json({ error: "Forbidden" }, 403); }
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    const validErr = await validateData(c, path, action, {});
    if (validErr) { crudLog("VALIDATION_FAILED", action, c, { id, error: validErr }); return c.json({ error: validErr }, 403); }
    try {
      if (hasSoftDelete) {
        const data = { isDeleted: true, deletedAt: new Date() };
        if (perm.rowLevelFilter) {
          const result = await model.updateMany({
            where: scopedWhere(pkField, id, perm.rowLevelFilter),
            data,
          });
          if (result.count === 0) return c.json({ error: "Not found" }, 404);
        } else {
          await model.update({ where: { [pkField]: id }, data });
        }
      } else if (perm.rowLevelFilter) {
        const result = await model.deleteMany({
          where: scopedWhere(pkField, id, perm.rowLevelFilter),
        });
        if (result.count === 0) return c.json({ error: "Not found" }, 404);
      } else {
        await model.delete({ where: { [pkField]: id } });
      }
      await logMutation?.({ action: "delete", recordId: id, data: null, userEmail: (c as any).get("session")?.email, orgId: (c as any).get("session")?.db?.orgId ?? null }).catch(console.error);
      return c.json({ message: "Deleted" });
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });
}
