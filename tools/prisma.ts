import { PrismaClient } from "./generated/prisma";
import { createCRUD, parseSchema, PermissionResult, MutationLogEntry } from "./createCRUD.ts";
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
  // pg-connection-string's own sslmode parsing is ambiguous/deprecated (it now
  // treats require/prefer as aliases for verify-full instead of encrypt-only),
  // so we derive the ssl option ourselves from sslmode and strip it from the
  // connection string to avoid that parsing taking over.
  const sslMode = dbUrl.searchParams.get("sslmode");
  dbUrl.searchParams.delete("sslmode");
  const ssl =
    !sslMode || sslMode === "disable"
      ? undefined
      : sslMode === "verify-full"
        ? true
        : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: dbUrl.toString(), ssl });
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
  logMutation?: (entry: MutationLogEntry) => Promise<void>,
) {
  const base = prefix.startsWith("/") ? prefix : `/${prefix}`;

  app.get(`${base}/_schema`, (c: any) => c.json(schemaCache));
  for (const model of Object.keys(prisma)) {
    if (model.startsWith("_")) continue;
    if (model.startsWith("$")) continue;
    if (model === "constructor") continue;

    const pkField = schemaCache[model]?.primaryKey || "id";
    const hasSoftDelete = schemaCache[model]?.fields.includes("isDeleted") ?? false;
    createCRUD(
      app,
      `${base}/${model}`,
      (prisma as any)[model],
      pkField,
      checkpermissions,
      validateData,
      logMutation,
      hasSoftDelete,
    );
  }
}

export { exposePrismaCRUD, prisma, createCRUD, schemaCache };
