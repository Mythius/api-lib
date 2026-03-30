// Setup:
// Open https://console.cloud.google.com/apis/credentials
// Create OAuth client ID → Application Type: Desktop App
// Download JSON → save as tools/googleapi/credentials.json
// Run once to authorize: bun run tools/googleapi/index.ts del

import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { createWriteStream } from "fs";
import { rm } from "fs/promises";
import { join } from "path";

// Use `any` for the auth client to avoid the OAuth2Client version mismatch
// between @google-cloud/local-auth and googleapis' internal dependency tree.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthClient = any;

const SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/script.scriptapp",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.send_mail",
  "https://www.googleapis.com/auth/script.locale",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

const TOKEN_PATH = join(process.cwd(), "tools/googleapi/token.json");
const CREDENTIALS_PATH = join(process.cwd(), "tools/googleapi/credentials.json");

async function loadSavedCredentialsIfExist(): Promise<AuthClient | null> {
  try {
    const content = await Bun.file(TOKEN_PATH).text();
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch {
    return null;
  }
}

async function saveCredentials(client: AuthClient): Promise<void> {
  const content = await Bun.file(CREDENTIALS_PATH).text();
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  await Bun.write(TOKEN_PATH, JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  }));
}

async function authorize(): Promise<AuthClient> {
  let client = await loadSavedCredentialsIfExist();
  if (client) return client;
  client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
  if (client.credentials) await saveCredentials(client);
  return client;
}

async function main() {
  await rm(TOKEN_PATH, { force: true });
  console.log("Deleted token");
  await Bun.sleep(300);
  await authorize();
  console.log("Authorized — good to go");
}

if (process.argv.includes("del")) {
  main();
}

export const login = loadSavedCredentialsIfExist;

export async function callAppsScriptFunction(
  scriptId: string,
  functionName: string,
  parameters: unknown[] = []
): Promise<unknown> {
  const auth = await login();
  const script = google.script({ version: "v1", auth });
  try {
    const res = await script.scripts.run({
      scriptId,
      requestBody: { function: functionName, parameters, devMode: true },
    });
    if (res.data.error) {
      console.error("Script error:", res.data.error.details);
      return null;
    }
    return res.data.response?.result ?? null;
  } catch (err) {
    console.error("API error:", err);
    return null;
  }
}

export async function exportPresentation(
  fileId: string,
  name: string,
  type: "pptx" | "pdf" = "pptx"
): Promise<void> {
  const auth = await login();
  const mimeType =
    type === "pptx"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : "application/pdf";
  const drive = google.drive({ version: "v3", auth });
  const result = await drive.files.export(
    { fileId, mimeType },
    { responseType: "stream" }
  );
  await new Promise<void>((resolve, reject) => {
    const dest = createWriteStream(`downloads/${name}.${type}`);
    (result.data as NodeJS.ReadableStream)
      .on("end", resolve)
      .on("error", reject)
      .pipe(dest);
  });
}

export async function downloadFile(fileId: string, name: string): Promise<string> {
  const auth = await login();
  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  return new Promise((resolve, reject) => {
    const dest = createWriteStream(name);
    (response.data as NodeJS.ReadableStream).pipe(dest);
    dest.on("finish", () => resolve(`File ${name} downloaded successfully`));
    dest.on("error", reject);
  });
}

export { google };
