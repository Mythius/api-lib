require("dotenv").config({ quiet: true });

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { loadKeys, publicKeyToJwks } = require("./auth/keys.js");
const { expose: exposeEndpoints } = require("./tools/listEndpoints.js");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 80;
const NODE_ENV = process.env.NODE_ENV || "development";
const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL || `http://localhost:${PORT}`;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const MS_CLIENT_ID = process.env.MS_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET;

const GOOGLE_CALLBACK = `${AUTH_BASE_URL}/auth/callback/google`;
const MS_CALLBACK = `${AUTH_BASE_URL}/auth/callback/microsoft`;

const MS_AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_URL = "https://graph.microsoft.com/v1.0/me";

// JWT issued by this server expires quickly — client apps must establish their
// own session from the payload and should not store or forward this token.
const JWT_EXPIRY = "10m";

// ---------------------------------------------------------------------------
// Load registered clients and RSA keys
// ---------------------------------------------------------------------------

let CLIENTS = [];
try {
  CLIENTS = require("./clients.json");
} catch {
  console.warn(
    "[AUTH] clients.json not found — no client apps are registered. " +
      "Create clients.json to allow OAuth logins."
  );
}

const { privateKey, publicKey } = loadKeys();
const JWKS = publicKeyToJwks(publicKey);

// ---------------------------------------------------------------------------
// Google OAuth client
// ---------------------------------------------------------------------------

const googleOAuthClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK
);

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------

const app = express();
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// CSRF state store
// State is a 32-byte hex string tied to (redirect_uri, client_id, provider).
// States expire after 10 minutes and are consumed exactly once.
// ---------------------------------------------------------------------------

const pendingStates = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now > val.expires) pendingStates.delete(key);
  }
}, 5 * 60 * 1000);

function generateState(redirectUri, clientId, provider) {
  const state = crypto.randomBytes(32).toString("hex");
  pendingStates.set(state, {
    redirect_uri: redirectUri,
    client_id: clientId,
    provider,
    expires: Date.now() + 10 * 60 * 1000,
  });
  return state;
}

function consumeState(state) {
  const data = pendingStates.get(state);
  if (!data) return null;
  pendingStates.delete(state);
  if (Date.now() > data.expires) return null;
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findClient(clientId) {
  return CLIENTS.find((c) => c.id === clientId) || null;
}

function validateRedirectUri(client, redirectUri) {
  // Exact string match only — no prefix matching, no wildcards.
  if (!client.allowedRedirects.includes(redirectUri)) return false;
  // In production, only allow HTTPS (except localhost for dev convenience).
  if (NODE_ENV === "production") {
    try {
      const url = new URL(redirectUri);
      if (url.protocol !== "https:" && url.hostname !== "localhost") {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function createJWT(userInfo) {
  return jwt.sign(userInfo, privateKey, {
    algorithm: "RS256",
    expiresIn: JWT_EXPIRY,
    issuer: "centralized-auth",
  });
}

function redirectWithToken(res, redirectUri, token) {
  const url = new URL(redirectUri);
  url.searchParams.set("token", token);
  res.redirect(url.toString());
}

function initOAuth(req, res, provider, buildAuthUrl) {
  const { client_id, redirect_uri } = req.query;

  if (!client_id || !redirect_uri) {
    return res
      .status(400)
      .json({ error: "client_id and redirect_uri are required" });
  }

  const client = findClient(client_id);
  if (!client) {
    return res.status(403).json({ error: "Unknown client_id" });
  }

  if (!validateRedirectUri(client, redirect_uri)) {
    return res
      .status(403)
      .json({ error: "redirect_uri is not allowed for this client" });
  }

  const state = generateState(redirect_uri, client_id, provider);
  res.redirect(buildAuthUrl(state));
}

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

app.get("/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res
      .status(503)
      .json({ error: "Google OAuth is not configured on this server" });
  }
  initOAuth(req, res, "google", (state) =>
    googleOAuthClient.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
      state,
    })
  );
});

app.get("/auth/callback/google", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send("Google authentication was cancelled or failed.");
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  const stateData = consumeState(state);
  if (!stateData) {
    return res.status(403).json({ error: "Invalid or expired state" });
  }

  try {
    const { tokens } = await googleOAuthClient.getToken({
      code,
      redirect_uri: GOOGLE_CALLBACK,
    });

    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const authToken = createJWT({
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture || null,
      provider: "google",
      client_id: stateData.client_id,
    });

    redirectWithToken(res, stateData.redirect_uri, authToken);
  } catch (err) {
    console.error("[AUTH] Google callback error:", err.message);
    res.status(500).json({ error: "Google authentication failed" });
  }
});

// ---------------------------------------------------------------------------
// Microsoft OAuth
// ---------------------------------------------------------------------------

app.get("/auth/microsoft", (req, res) => {
  if (!MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    return res
      .status(503)
      .json({ error: "Microsoft OAuth is not configured on this server" });
  }
  initOAuth(req, res, "microsoft", (state) => {
    const params = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      response_type: "code",
      redirect_uri: MS_CALLBACK,
      response_mode: "query",
      scope: "openid profile email User.Read",
      state,
    });
    return `${MS_AUTH_URL}?${params}`;
  });
});

app.get("/auth/callback/microsoft", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res
      .status(400)
      .send("Microsoft authentication was cancelled or failed.");
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  const stateData = consumeState(state);
  if (!stateData) {
    return res.status(403).json({ error: "Invalid or expired state" });
  }

  try {
    const tokenResponse = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        code,
        redirect_uri: MS_CALLBACK,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) {
      console.error("[AUTH] MS token exchange failed:", tokenData.error);
      return res.status(401).json({ error: "Token exchange failed" });
    }

    const profileResponse = await fetch(MS_GRAPH_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();

    const email = profile.mail || profile.userPrincipalName;
    if (!email) {
      return res.status(400).json({ error: "Could not retrieve user email" });
    }

    const authToken = createJWT({
      sub: profile.id,
      email,
      name: profile.displayName || email,
      picture: null,
      provider: "microsoft",
      client_id: stateData.client_id,
    });

    redirectWithToken(res, stateData.redirect_uri, authToken);
  } catch (err) {
    console.error("[AUTH] Microsoft callback error:", err.message);
    res.status(500).json({ error: "Microsoft authentication failed" });
  }
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

// Derive the set of allowed origins from each client's registered redirect URIs.
// e.g. "https://app1.example.com/auth/callback" → "https://app1.example.com"
const ALLOWED_ORIGINS = new Set(
  CLIENTS.flatMap((c) =>
    c.allowedRedirects.map((uri) => {
      try { return new URL(uri).origin; } catch { return null; }
    })
  ).filter(Boolean)
);

// Apply CORS headers for a specific response.
// origin: "*" for public endpoints, or the validated request origin for restricted ones.
function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ---------------------------------------------------------------------------
// Public key / token verification endpoints
// ---------------------------------------------------------------------------

// Expose the public key as JWKS so client apps can verify tokens locally
// without making a network round-trip on every request.
// CORS: open to all origins — the public key is not sensitive.
app.get("/auth/jwks.json", (_req, res) => {
  setCors(res, "*");
  res.json(JWKS);
});

// Server-to-server token verification endpoint.
// Client apps can POST a token here and receive the verified payload.
// CORS: restricted to registered client origins only.
app.options("/auth/verify", (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    setCors(res, origin);
  }
  res.sendStatus(204);
});

app.post("/auth/verify", (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    setCors(res, origin);
  }

  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "token is required" });
  }
  try {
    const payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      issuer: "centralized-auth",
    });
    // Strip JWT metadata before returning — clients only need the user claims.
    const { iat, exp, iss, ...user } = payload;
    res.json({ valid: true, user });
  } catch (err) {
    res.status(401).json({ valid: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Dev tools & startup
// ---------------------------------------------------------------------------

exposeEndpoints(app);

app.listen(PORT, () => {
  console.log(`[AUTH] Server listening at ${AUTH_BASE_URL}`);
  console.log(`[AUTH] Registered clients: ${CLIENTS.map((c) => c.id).join(", ") || "none"}`);
});
