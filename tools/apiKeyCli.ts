// Interactive API key management. Run with: bun run apikeys
//
// Deliberately uses `node:readline` (callback style) driven by hand via its
// async iterator, NOT `node:readline/promises`'s `rl.question()` -- on Bun
// for Windows, a second `question()` call on the same interface hangs forever
// (the async-iterator form below does not have this problem).
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  apiKeysEnabled,
  createApiKey,
  findApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyRecord,
} from "./apiKeys.ts";

if (!(await apiKeysEnabled())) {
  console.log(
    "API keys are not enabled: add `model ApiKey` to prisma/schema.prisma, " +
      "run `bunx prisma generate` and `bunx prisma db push`, and make sure DATABASE_URL is set.",
  );
  process.exit(1);
}

// Role choices come from a generated ApiKeyRole enum if the project made
// `role` an enum, so adding a role to the schema shows up here without
// editing this file. With a plain String column it's free text.
async function loadRoles(): Promise<string[]> {
  try {
    const mod: any = await import("./generated/prisma");
    return Object.values(mod.ApiKeyRole ?? {}) as string[];
  } catch {
    return [];
  }
}
const ROLES = await loadRoles();

const rl = createInterface({ input: stdin, output: stdout });
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string): Promise<string> {
  stdout.write(question);
  const { value, done } = await lines.next();
  return done ? "" : value.trim();
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "never";
}

function formatKey(k: ApiKeyRecord): string {
  const status = k.revokedAt ? `revoked ${fmtDate(k.revokedAt)}` : "active";
  return (
    `${k.prefix}...  [${k.role}]  ${status}  ` +
    `created ${fmtDate(k.createdAt)}  last used ${fmtDate(k.lastUsedAt)}  ` +
    `label="${k.label}"  id=${k.id}`
  );
}

async function doList(): Promise<ApiKeyRecord[]> {
  const keys = await listApiKeys();
  if (keys.length === 0) {
    console.log("No API keys yet.");
  } else {
    console.log("");
    for (const k of keys) console.log(formatKey(k));
  }
  return keys;
}

async function pickRole(): Promise<string> {
  while (true) {
    if (ROLES.length === 0) {
      const role = await ask(
        'Role ("READ_ONLY", "ALL", or a custom role your setApiKeyAuthorizer handles): ',
      );
      if (role) return role;
      continue;
    }
    ROLES.forEach((r, i) => console.log(`  ${i + 1}) ${r}`));
    const ans = await ask(`Role [1-${ROLES.length}]: `);
    const byIndex = ROLES[parseInt(ans, 10) - 1];
    const byName = ROLES.find((r) => r.toLowerCase() === ans.toLowerCase());
    if (byIndex || byName) return (byIndex || byName)!;
    console.log("Please pick one of the listed roles.");
  }
}

function printNewKey(raw: string, record: ApiKeyRecord): void {
  console.log("\nThis is the ONLY time the full key is shown -- copy it now:\n");
  console.log(`  ${raw}\n`);
  console.log(formatKey(record));
  console.log(`\nSend it as a header: Authorization: Bearer ${record.prefix}...`);
}

async function doCreate(): Promise<void> {
  const label = await ask('Label (e.g. "Reporting export job"): ');
  if (!label) {
    console.log("Label is required, aborting.");
    return;
  }
  const role = await pickRole();
  const { raw, record } = await createApiKey(label, role);
  printNewKey(raw, record);
}

async function pickExisting(verb: string): Promise<ApiKeyRecord | null> {
  const keys = await doList();
  if (keys.length === 0) return null;
  const key = await findApiKey(await ask(`\nEnter the id or key prefix to ${verb}: `));
  if (!key) console.log("No matching key found.");
  return key;
}

async function doRevoke(): Promise<void> {
  const key = await pickExisting("revoke");
  if (!key) return;
  if (key.revokedAt) {
    console.log("That key is already revoked.");
    return;
  }
  const confirm = await ask(`Revoke "${key.label}" (${key.prefix}...)? [y/N]: `);
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }
  await revokeApiKey(key.id);
  console.log("Revoked.");
}

async function doRotate(): Promise<void> {
  const key = await pickExisting("rotate");
  if (!key) return;
  const confirm = await ask(
    `Rotate "${key.label}" (${key.prefix}...)? This revokes the old key immediately ` +
      `and issues a new one with the same label/role. [y/N]: `,
  );
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }
  const { raw, record } = await rotateApiKey(key);
  printNewKey(raw, record);
}

console.log("API Key Manager");
console.log(`Database: ${process.env.DATABASE_URL?.split("/").pop()?.split("?")[0]}`);

const MENU = "\n1) List keys\n2) Create key\n3) Revoke key\n4) Rotate key\n5) Exit\n";
while (true) {
  console.log(MENU);
  const choice = await ask("> ");
  try {
    if (choice === "1") await doList();
    else if (choice === "2") await doCreate();
    else if (choice === "3") await doRevoke();
    else if (choice === "4") await doRotate();
    else if (choice === "5" || choice.toLowerCase() === "q" || choice === "") break;
    else console.log("Unknown option.");
  } catch (err) {
    console.error("Error:", (err as Error).message);
  }
}

rl.close();
process.exit(0);
