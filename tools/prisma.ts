import { PrismaClient } from "./generated/prisma";
import { createCRUD, parseSchema, PermissionResult } from "./createCRUD.ts";
import { Context, Hono } from "hono";

const dbUrl = new URL(process.env.DATABASE_URL!);
const scheme = dbUrl.protocol.replace(":", "");

let adapter;

if (scheme === "mysql" || scheme === "mariadb") {
  const { PrismaMariaDb } = await import("@prisma/adapter-mariadb");
  adapter = new PrismaMariaDb({
    host: dbUrl.hostname,
    port: Number(dbUrl.port) || 3306,
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.slice(1),
  });
} else if (scheme === "postgres" || scheme === "postgresql") {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  adapter = new PrismaPg(pool);
} else {
  throw new Error(
    `Unsupported database scheme: ${scheme}. Use mysql://, mariadb://, or postgres://`,
  );
}

const prisma = new PrismaClient({ adapter });
const schemaCache = parseSchema();

function exposePrismaCRUD(
  prefix: string = "api",
  app: Hono,
  checkpermissions: (
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
  app.get(`/${prefix}/_schema`, (c: any) => c.json(schemaCache));
  for (const model of Object.keys(prisma)) {
    if (model.startsWith("_")) continue;
    if (model.startsWith("$")) continue;
    if (model === "constructor") continue;

    const pkField = schemaCache[model]?.primaryKey || "id";
    createCRUD(
      app,
      `${prefix}/${model}`,
      (prisma as any)[model],
      pkField,
      checkpermissions,
      validateData,
    );
  }
}

export { exposePrismaCRUD, prisma, createCRUD, schemaCache };
