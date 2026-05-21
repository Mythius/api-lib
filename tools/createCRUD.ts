import { Hono } from "hono";
import { readFileSync } from "fs";
import { Context } from "hono";

export interface PrismaDelegate {
  findMany(args?: object): Promise<unknown[]>;
  findFirst(args?: object): Promise<unknown | null>;
  create(args: { data: unknown }): Promise<unknown>;
  findUnique(args: { where: object }): Promise<unknown | null>;
  update(args: { where: object; data: unknown }): Promise<unknown>;
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

function parseId(param: string): string | null {
  return param;
  // const id = parseInt(param);
  // return isNaN(id) ? null : id;
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
      }
    }

    const prismaKey = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    result[prismaKey] = { primaryKey, fields, foreignKeys };
  }

  return result;
}

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
) {
  async function permit(action: string, c: Context): Promise<PermissionResult> {
    return normalizePermission(await checkPermissions(action, c));
  }

  app.get(path, async (c) => {
    const perm = await permit("GET:" + path, c);
    if (!perm.allowed) return c.json({ error: "Forbidden" }, 403);
    try {
      const items = await model.findMany(
        perm.rowLevelFilter ? { where: perm.rowLevelFilter } : undefined,
      );
      return c.json(items);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.get(`${path}/:id`, async (c) => {
    const perm = await permit("GET:" + path, c);
    if (!perm.allowed) return c.json({ error: "Forbidden" }, 403);
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    try {
      const where = perm.rowLevelFilter
        ? { [pkField]: id, ...perm.rowLevelFilter }
        : { [pkField]: id };
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
    const perm = await permit("GET:" + path, c);
    if (!perm.allowed) return c.json({ error: "Forbidden" }, 403);
    const page = parseInt(c.req.param("page") || "1") ?? 1;
    const pageSize = parseInt(c.req.param("pageSize") || "10") ?? 10;
    try {
      const items = await model.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        ...(perm.rowLevelFilter ? { where: perm.rowLevelFilter } : {}),
      });
      return c.json(items);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.post(path + "/filter", async (c) => {
    const perm = await permit("GET:" + path, c);
    if (!perm.allowed) return c.json({ error: "Forbidden" }, 403);
    try {
      const body = await c.req.json();
      const where = perm.rowLevelFilter
        ? { AND: [body, perm.rowLevelFilter] }
        : body;
      const items = await model.findMany({ where });
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
    if (!perm.allowed) return c.json({ error: "Forbidden" }, 403);
    try {
      const body = await c.req.json();
      const validErr = await validateData(c, path, action, body);
      if (validErr) return c.json({ error: validErr }, 403);
      if (perm.rowLevelFilter) {
        for (const [key, val] of Object.entries(perm.rowLevelFilter)) {
          if (key in body && body[key] !== val)
            return c.json({ error: "Forbidden" }, 403);
        }
        Object.assign(body, perm.rowLevelFilter);
      }
      const item = await model.create({ data: stripSystemFields(body) });
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
    if (!perm.allowed) return c.json({ error: "Forbidden" }, 403);
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    try {
      const body = await c.req.json();
      const validErr = await validateData(c, path, action, body);
      if (validErr) return c.json({ error: validErr }, 403);
      if (perm.rowLevelFilter) {
        const owned = await model.findFirst({
          where: { [pkField]: id, ...perm.rowLevelFilter },
        });
        if (!owned) return c.json({ error: "Not found" }, 404);
      }
      const item = await model.update({ where: { [pkField]: id }, data: stripSystemFields(body) });
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
    if (!perm.allowed) return c.json({ error: "Forbidden" }, 403);
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    const validErr = await validateData(c, path, action, {});
    if (validErr) return c.json({ error: validErr }, 403);
    try {
      if (perm.rowLevelFilter) {
        const result = await model.deleteMany({
          where: { [pkField]: id, ...perm.rowLevelFilter },
        });
        if (result.count === 0) return c.json({ error: "Not found" }, 404);
      } else {
        await model.delete({ where: { [pkField]: id } });
      }
      return c.json({ message: "Deleted" });
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });
}
