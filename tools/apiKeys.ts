// Machine credentials (API keys) for script/service access. Wired into the
// auth middleware in tools/auth.ts; manage keys with `bun run apikeys`
// (tools/apiKeyCli.ts).
//
// Entirely optional: everything here keys off whether the generated Prisma
// client has an `apiKey` model. Delete `model ApiKey` (and its enum) from
// prisma/schema.prisma, regenerate, and API keys simply switch off — no code
// changes needed. That's also why nothing here imports types/enums from
// ./generated/prisma or imports ./prisma.ts statically: either would crash at
// load time once the model (or the database) is gone.
//
// Only a sha256 hash of each key is stored; the raw key is shown once, at
// creation/rotation.
import { randomBytes, createHash } from "node:crypto";
import type { Context } from "hono";

// Identifies a bearer token as an API key (vs. a session token) without a DB
// round-trip, and forms the non-secret `prefix` column shown in listings.
// Changing it later orphans every existing key, so pick one per project up
// front (e.g. "myapp_").
export const API_KEY_PREFIX = process.env.API_KEY_PREFIX || "ak_";

// Stored length of the `prefix` column: API_KEY_PREFIX plus 8 random chars —
// enough to tell keys apart in a listing without revealing the secret.
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

// Shape of an ApiKey row as this module uses it. `role` is a plain string
// rather than the generated ApiKeyRole enum so projects can add roles (or
// swap the enum for a String column) without touching this file. Extra
// columns a project adds (e.g. userId, orgId, expiresAt) come through on the
// record passed to the hooks below.
export interface ApiKeyRecord {
  id: string;
  label: string;
  prefix: string;
  hashedKey: string;
  role: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  [extra: string]: unknown;
}

// The slice of the Prisma delegate this module needs.
export interface ApiKeyDelegate {
  findUnique(args: object): Promise<ApiKeyRecord | null>;
  findFirst(args: object): Promise<ApiKeyRecord | null>;
  findMany(args?: object): Promise<ApiKeyRecord[]>;
  create(args: { data: object }): Promise<ApiKeyRecord>;
  update(args: { where: object; data: object }): Promise<ApiKeyRecord>;
}

// ---------------------------------------------------------------------------
// Model detection
// ---------------------------------------------------------------------------
// undefined = not looked up yet; null = API keys are off.
let delegate: ApiKeyDelegate | null | undefined;

async function getDelegate(): Promise<ApiKeyDelegate | null> {
  if (delegate !== undefined) return delegate;
  try {
    const { prisma } = await import("./prisma.ts");
    delegate = ((prisma as any).apiKey as ApiKeyDelegate | undefined) ?? null;
  } catch (err) {
    // No DATABASE_URL, unsupported scheme, client not generated, ... — the
    // rest of the app may not need a database at all, so don't take it down.
    console.warn("API keys disabled (Prisma client unavailable):", (err as Error).message);
    delegate = null;
  }
  return delegate;
}

// Overrides model detection — pass a delegate to store keys somewhere else
// (or a test fake), or null to switch API keys off explicitly.
export function setApiKeyDelegate(d: ApiKeyDelegate | null): void {
  delegate = d;
}

export async function apiKeysEnabled(): Promise<boolean> {
  return (await getDelegate()) !== null;
}

async function requireDelegate(): Promise<ApiKeyDelegate> {
  const d = await getDelegate();
  if (!d) {
    throw new Error(
      "API keys are not enabled: add `model ApiKey` to prisma/schema.prisma and run `bunx prisma generate`.",
    );
  }
  return d;
}

// ---------------------------------------------------------------------------
// Key lifecycle
// ---------------------------------------------------------------------------
export function isApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawKey(): string {
  return API_KEY_PREFIX + randomBytes(24).toString("hex");
}

// `extra` sets any project-specific columns on the new row (e.g. { userId }).
export async function createApiKey(
  label: string,
  role: string,
  extra: Record<string, unknown> = {},
): Promise<{ raw: string; record: ApiKeyRecord }> {
  const d = await requireDelegate();
  const raw = generateRawKey();
  const record = await d.create({
    data: {
      ...extra,
      label,
      role,
      hashedKey: hashApiKey(raw),
      prefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
    },
  });
  return { raw, record };
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const d = await requireDelegate();
  return d.findMany({ orderBy: { createdAt: "desc" } });
}

// Accepts either the row id or (a leading part of) the display prefix.
export async function findApiKey(idOrPrefix: string): Promise<ApiKeyRecord | null> {
  if (!idOrPrefix) return null;
  const d = await requireDelegate();
  return d.findFirst({
    where: { OR: [{ id: idOrPrefix }, { prefix: { startsWith: idOrPrefix } }] },
  });
}

export async function revokeApiKey(id: string): Promise<ApiKeyRecord> {
  const d = await requireDelegate();
  return d.update({ where: { id }, data: { revokedAt: new Date() } });
}

// Revokes the old key immediately and issues a new one with the same label,
// role and any project-specific columns passed through `carryOver`.
export async function rotateApiKey(
  key: ApiKeyRecord,
  carryOver: string[] = [],
): Promise<{ raw: string; record: ApiKeyRecord }> {
  if (!key.revokedAt) await revokeApiKey(key.id);
  const extra = Object.fromEntries(carryOver.map((k) => [k, key[k]]));
  return createApiKey(key.label, key.role, extra);
}

// Looks up an active key by its raw value; null if unknown, revoked, or API
// keys are off. Bumps lastUsedAt fire-and-forget so a slow/failed write never
// adds latency to the request it's authenticating.
export async function verifyApiKey(raw: string): Promise<ApiKeyRecord | null> {
  const d = await getDelegate();
  if (!d) return null;
  let key: ApiKeyRecord | null;
  try {
    key = await d.findUnique({ where: { hashedKey: hashApiKey(raw) } });
  } catch (err) {
    // e.g. the model exists in the client but `prisma db push` hasn't created
    // the table yet — fail closed for this request rather than 500.
    console.error("API key lookup failed:", (err as Error).message);
    return null;
  }
  if (!key || key.revokedAt) return null;
  d.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch((err) =>
    console.warn("Failed to update ApiKey.lastUsedAt:", err),
  );
  return key;
}

// ---------------------------------------------------------------------------
// Authorization hooks
// ---------------------------------------------------------------------------
export type ApiKeyAuthorizer = (
  key: ApiKeyRecord,
  c: Context,
) => boolean | Promise<boolean>;

// Default policy for the two roles in the template schema: ALL can do
// anything; READ_ONLY can make GET/HEAD requests plus the CRUD `/filter`
// route (a read that happens to be a POST). Unknown roles are denied, so a
// role added to the enum does nothing until the project's authorizer
// handles it.
export const defaultApiKeyAuthorizer: ApiKeyAuthorizer = (key, c) => {
  if (key.role === "ALL") return true;
  if (key.role === "READ_ONLY") {
    const method = c.req.method;
    return method === "GET" || method === "HEAD" || (method === "POST" && c.req.path.endsWith("/filter"));
  }
  return false;
};

let authorizer: ApiKeyAuthorizer = defaultApiKeyAuthorizer;

// Runs on every API-key request before the route (a 403 when it returns
// false) — the one place to decide what each role may reach. For finer
// per-model rules, check `session.apiKey` in your createCRUD checkPermissions
// as well.
export function setApiKeyAuthorizer(fn: ApiKeyAuthorizer): void {
  authorizer = fn;
}

export function authorizeApiKey(key: ApiKeyRecord, c: Context): boolean | Promise<boolean> {
  return authorizer(key, c);
}
