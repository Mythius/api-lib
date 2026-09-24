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

// Validates a POST/PUT body before it reaches Prisma. Prisma treats any
// relation field in `data` as a nested write (create/connect/update/upsert/
// delete on the related model), so passing the body through as-is lets a
// caller who may only edit their own row reach into related rows — e.g.
// `{ organization: { update: { users: { update: { where: ..., data: { role:
// "ADMIN" } } } } } }` on a row the caller owns escalates their privileges
// even though validateData/rowLevelFilter only ever see top-level scalars. So:
//   - with `scalarFields` (exposePrismaCRUD passes the model's scalar
//     columns + FK columns from parseSchema), any other key is rejected;
//   - without it (a hand-mounted createCRUD with no schema info), object
//     values are rejected outright since that's the shape every nested write
//     takes — pass scalarFields to allow Json columns.
// System fields are still silently dropped rather than rejected, since
// clients routinely PUT back a row exactly as they GET it.
function sanitizeWriteBody(
  body: unknown,
  scalarFields?: Set<string>,
): { data: Record<string, unknown> } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }
  const data = stripSystemFields(body as Record<string, unknown>);
  const rejected = Object.entries(data)
    .filter(([k, v]) =>
      scalarFields
        ? !scalarFields.has(k)
        : v !== null && typeof v === "object",
    )
    .map(([k]) => k);
  if (rejected.length) {
    return { error: `Field(s) not writable through this endpoint: ${rejected.join(", ")}` };
  }
  return { data };
}

// Operators Prisma accepts inside a scalar (or Json) field's filter. Relation
// filters use a disjoint vocabulary (some/every/none/is/isNot, or the related
// model's own field names), so allowing only these keeps a filter from
// reaching across relations even when no field list is available.
const SCALAR_FILTER_OPS = new Set([
  "equals", "in", "notIn", "lt", "lte", "gt", "gte", "not",
  "contains", "startsWith", "endsWith", "mode", "search",
  "has", "hasSome", "hasEvery", "isEmpty", "isSet",
  "path", "string_contains", "string_starts_with", "string_ends_with",
  "array_contains", "array_starts_with", "array_ends_with",
]);
const LOGICAL_OPS = new Set(["AND", "OR", "NOT"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Validates a /filter body before it's used as a Prisma `where`. Without
// this, a relation filter like `{ organization: { users: { some: { role:
// "ADMIN", email: { startsWith: "a" } } } } }` lets a caller probe rows in
// other models — and outside their rowLevelFilter scope — one guess at a
// time, since rowLevelFilter only narrows the top-level model. Returns an
// error naming the first offending path, or null if the clause is safe.
function validateWhere(
  where: unknown,
  scalarFields?: Set<string>,
  path = "",
): string | null {
  if (!isPlainObject(where)) return `${path || "body"} must be an object`;
  for (const [key, value] of Object.entries(where)) {
    const here = path ? `${path}.${key}` : key;
    if (LOGICAL_OPS.has(key)) {
      const clauses = Array.isArray(value) ? value : [value];
      for (const [i, clause] of clauses.entries()) {
        const err = validateWhere(clause, scalarFields, Array.isArray(value) ? `${here}[${i}]` : here);
        if (err) return err;
      }
      continue;
    }
    if (scalarFields && !scalarFields.has(key)) {
      return `Cannot filter on ${here}`;
    }
    const err = validateScalarFilter(value, here);
    if (err) return err;
  }
  return null;
}

function validateScalarFilter(value: unknown, path: string): string | null {
  // Primitives, null, Dates-as-strings and arrays are plain equality/list
  // values — only an object can open up a nested (relation) filter.
  if (!isPlainObject(value)) return null;
  for (const [op, operand] of Object.entries(value)) {
    if (!SCALAR_FILTER_OPS.has(op)) return `Cannot filter on ${path}.${op}`;
    if (op === "not") {
      const err = validateScalarFilter(operand, `${path}.not`);
      if (err) return err;
    }
  }
  return null;
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
  // Needed up front so relation fields can be told apart from scalars even
  // when they carry no @relation attribute (the back side of a 1:1, e.g.
  // `profile Profile?`) — those must never land in `fields`, which doubles as
  // the write allow-list in createCRUD.
  const modelNames = new Set(
    [...schemaText.matchAll(modelRegex)].map((m) => m[1]!),
  );
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
      } else if (!modelNames.has(fieldType) && !trimmed.includes("@relation")) {
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
  // The model's own columns (scalars + FK columns, no relation fields) — the
  // allow-list for POST/PUT bodies (see sanitizeWriteBody) and /filter
  // where-clauses (see validateWhere). exposePrismaCRUD fills this from the
  // parsed schema; omit it only for hand-mounted routes.
  scalarFields?: string[],
) {
  const scalars = scalarFields ? new Set(scalarFields) : undefined;

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
      const whereErr = validateWhere(body, scalars);
      if (whereErr) { crudLog("VALIDATION_FAILED", action + " (filter)", c, { error: whereErr }); return c.json({ error: whereErr }, 400); }
      const combined = perm.rowLevelFilter
        ? { AND: [body, perm.rowLevelFilter] }
        : body;
      const where = withDefaults(c, combined, "isDeleted" in body);

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
      const sanitized = sanitizeWriteBody(await c.req.json(), scalars);
      if ("error" in sanitized) { crudLog("VALIDATION_FAILED", action, c, { error: sanitized.error }); return c.json({ error: sanitized.error }, 400); }
      const body = sanitized.data;
      const validErr = await validateData(c, path, action, body);
      if (validErr) { crudLog("VALIDATION_FAILED", action, c, { error: validErr, body }); return c.json({ error: validErr }, 403); }
      if (perm.rowLevelFilter) {
        for (const [key, val] of Object.entries(perm.rowLevelFilter)) {
          if (key in body && body[key] !== val)
            return c.json({ error: "Forbidden" }, 403);
        }
        Object.assign(body, perm.rowLevelFilter);
      }
      const item = await model.create({ data: body });
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
      const raw = await c.req.json();
      const clientUpdatedAt: string | undefined = raw?.updatedAt;
      const sanitized = sanitizeWriteBody(raw, scalars);
      if ("error" in sanitized) { crudLog("VALIDATION_FAILED", action, c, { id, error: sanitized.error }); return c.json({ error: sanitized.error }, 400); }
      const body = sanitized.data;
      const validErr = await validateData(c, path, action, body);
      if (validErr) { crudLog("VALIDATION_FAILED", action, c, { id, error: validErr, body }); return c.json({ error: validErr }, 403); }
      if (perm.rowLevelFilter) {
        // Same rule as POST: an update can't move a row out of the caller's
        // scope by rewriting the column the scope is keyed on.
        for (const [key, val] of Object.entries(perm.rowLevelFilter)) {
          if (key in body && body[key] !== val)
            return c.json({ error: "Forbidden" }, 403);
        }
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
      const item = await model.update({ where: { [pkField]: id }, data: body });
      await logMutation?.({ action: "update", recordId: id, data: body, userEmail: (c as any).get("session")?.email, orgId: (c as any).get("session")?.db?.orgId ?? null }).catch(console.error);
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
