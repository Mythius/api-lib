// npm i @google-cloud/local-auth googleapis
// Open https://console.cloud.google.com/apis/credentials
// Create Client OAuth client ID
// Application Type: Desktop Client
// download JSON save as google/credentials.json
// Add to package.json scripts:
// "auth": "node google/authorize.js del"
const fsp = require("fs").promises;
const fs = require("fs");
const path = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

// If modifying these scopes, delete token.json.
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
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.

const TOKEN_PATH = path.join(process.cwd(), "google/token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "google/credentials.json");

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fsp.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fsp.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fsp.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

function wait(n = 0.5) {
  return new Promise((res, rej) => {
    setTimeout(() => {
      res();
    }, n * 1000);
  });
}

async function main() {
  await fsp.rm("google/token.json", { force: true });
  console.log("Deleted token");
  await wait(0.3);
  await authorize();
  console.log("Authorized");
  console.log("Good to go");
}

if (process.argv.includes("del")) {
  main();
}

const login = loadSavedCredentialsIfExist;

async function callAppsScriptFunction(scriptId, functionName, parameters = []) {
  let oAuth2Client = await login();

  const script = google.script({ version: "v1", auth: oAuth2Client });

  try {
    const res = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: functionName,
        parameters: parameters,
        devMode: true, // optional, for latest version of the script
      },
    });

    if (res.data.error) {
      // The API executed, but the script returned an error.
      console.error("Script error:", res.data.error.details);
      return null;
    } else {
      console.log("Function result:", res.data.response.result);
      return res.data.response.result;
    }
  } catch (err) {
    console.error("API error:", err);
    return null;
  }
}

async function exportPresentation(fileId, name, type = "pptx") {
  let auth = await login();
  // MIME TYPES: https://developers.google.com/drive/api/guides/ref-export-formats
  const mimeType =
    type == "pptx"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : "application/pdf";
  const service = google.drive({ version: "v3", auth });

  try {
    const result = await service.files.export(
      {
        fileId: fileId,
        mimeType: mimeType,
      },
      { responseType: "stream" }
    );
    const dest = fs.createWriteStream(`downloads/${name}.${type}`);
    result.data
      .on("end", () => {
        console.log("File saved successfully.");
      })
      .on("error", (err) => {
        console.error("Error saving the file:", err);
      })
      .pipe(dest);
  } catch (err) {
    throw err;
  }
}

exports.login = login;
exports.google = google;
exports.callAppsScriptFunction = callAppsScriptFunction;
exports.exportPresentation = exportPresentation;