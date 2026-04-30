import { Hono } from "hono";
import { readFileSync } from "fs";
import { Context } from "hono";

export interface PrismaDelegate {
  findMany(args?: object): Promise<unknown[]>;
  create(args: { data: unknown }): Promise<unknown>;
  findUnique(args: { where: object }): Promise<unknown | null>;
  update(args: { where: object; data: unknown }): Promise<unknown>;
  delete(args: { where: object }): Promise<unknown>;
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
function handlePrismaError(c: any, error: unknown) {
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
  ) => boolean | Promise<boolean> = () => true,
) {
  app.get(path, async (c) => {
    if (!(await checkPermissions("GET", c)))
      return c.json({ error: "Forbidden" }, 403);
    try {
      const items = await model.findMany();
      return c.json(items);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.get(`${path}/:id`, async (c) => {
    if (!(await checkPermissions("GET", c)))
      return c.json({ error: "Forbidden" }, 403);
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    try {
      const item = await model.findUnique({ where: { [pkField]: id } });
      if (!item) return c.json({ error: "Not found" }, 404);
      return c.json(item);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.get(path + "/page/:page/:pageSize", async (c) => {
    if (!(await checkPermissions("GET", c)))
      return c.json({ error: "Forbidden" }, 403);
    const page = parseInt(c.req.param("page") || "1") ?? 1;
    const pageSize = parseInt(c.req.param("pageSize") || "10") ?? 10;
    try {
      const items = await model.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return c.json(items);
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });

  app.post(path + "/filter", async (c) => {
    if (!(await checkPermissions("GET", c)))
      return c.json({ error: "Forbidden" }, 403);
    try {
      const body = await c.req.json();
      const items = await model.findMany({ where: body });
      return c.json(items);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return handlePrismaError(c, error);
    }
  });

  app.post(path, async (c) => {
    if (!(await checkPermissions("POST", c)))
      return c.json({ error: "Forbidden" }, 403);
    try {
      const body = await c.req.json();
      const item = await model.create({ data: body });
      return c.json(item, 201);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return handlePrismaError(c, error);
    }
  });

  app.put(`${path}/:id`, async (c) => {
    if (!(await checkPermissions("PUT", c)))
      return c.json({ error: "Forbidden" }, 403);
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    try {
      const body = await c.req.json();
      const item = await model.update({ where: { [pkField]: id }, data: body });
      return c.json(item);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return handlePrismaError(c, error);
    }
  });

  app.delete(`${path}/:id`, async (c) => {
    if (!(await checkPermissions("DELETE", c)))
      return c.json({ error: "Forbidden" }, 403);
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid ID" }, 400);
    try {
      await model.delete({ where: { [pkField]: id } });
      return c.json({ message: "Deleted" });
    } catch (error) {
      return handlePrismaError(c, error);
    }
  });
}
