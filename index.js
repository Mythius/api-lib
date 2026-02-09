require("dotenv").config({ quiet: true });
const port = process.env.PORT || 80;
const google_client_id =
  "1016767921529-6ht5kllaqo7627qcb9p7fv7vilc66aos.apps.googleusercontent.com";
const google_client_secret = process.env.GOOGLE_CLIENT_SECRET || "";
const google_redirect_uri =
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/callback/google`;
// npm i express path fs md5 body-parser express-fileupload google-auth-library dotenv cookie-parser
const express = require("express");
const path = require("path");
const md5 = require("md5");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const cookieParser = require("cookie-parser");
const app = express();
const API = require("./api.js");
const { file, fs } = require("./tools/file.js");
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(google_client_id);
// Separate OAuth client for redirect-based flow (requires client secret)
const oauthClient = new OAuth2Client(
  google_client_id,
  google_client_secret,
  google_redirect_uri,
);
const exposeEndpoints = require("./tools/listEndpoints.js").expose;

app.use(cookieParser());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(
  fileUpload({ limits: { fileSize: 50000000 /*50 MB*/ }, abortOnLimit: true }),
);
app.use(express.static(path.join(__dirname, "public")));

// Helper to set auth cookie
function setAuthCookie(res, token) {
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}
app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});

let auth = {};
let sessions = {};

async function verifyToken(token) {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: google_client_id,
  });
  const payload = ticket.getPayload();
  const userId = payload["sub"];
  // If request specified a G Suite domain:
  // const domain = payload['hd'];
  return payload;
}

function loadAuth() {
  return new Promise((res, rej) => {
    file.read(
      "auth.json",
      (e) => {
        auth = JSON.parse(e);
        res();
      },
      (error) => {
        file.save("auth.json", "{}");
        res();
      },
    );
  });
}

function saveAuth() {
  file.save("auth.json", JSON.stringify(auth));
}

function loginCallback(session) {
  saveAuth();
  if (API.onLogin) API.onLogin(session);
}

exposeEndpoints(app);

app.post("/auth", async (req, res) => {
  try {
    const cred = req.body;
    if (!(cred.username in auth)) {
      await loadAuth();
    }
    if (!(cred.username in auth)) {
      res.status(403).json({ error: "Couldn't log in" });
      return;
    }
    if (md5(cred.password) == auth[cred.username].password) {
      let token = md5(new Date().toISOString() + cred.username);
      delete sessions[auth[cred.username].token];
      sessions[token] = { user: auth[cred.username] };
      sessions[token].username = cred.username;
      auth[cred.username].token = token;
      setAuthCookie(res, token);
      res.json({ message: "Successfully Logged In" });
    } else {
      res.status(403).json({ error: "Couldn't log in" });
      return;
    }
  } catch (e) {
    console.warn(e);
    return res.status(403).json({ error: e });
  }
});

app.post("/auth/google-oneclick", async (req, res) => {
  try {
    let cred = req.body;
    let data = await verifyToken(cred.credential);
    if (!(cred.email in auth)) {
      auth[cred.email] = { priv: 0, token: "" };
    }
    if (auth[cred.email].token) delete sessions[auth[cred.email].token];
    let token = md5(new Date().toISOString() + cred.email);
    sessions[token] = { user: auth[cred.email] };
    sessions[token].username = cred.name;
    sessions[token].email = data.email;
    sessions[token].google_data = data;
    sessions[token].photoUrl = data.picture;
    auth[cred.email].token = token;
    loginCallback(sessions[token]);
    setAuthCookie(res, token);
    res.status(200).json({ message: "Successfully Logged In" });
  } catch (e) {
    console.error(e);
    res.status(403).json({ error: "Invalid Google Login" });
  }
});

// Helper to check Google OAuth redirect environment variables
function checkGoogleOAuthEnvVars() {
  const required = ["GOOGLE_CLIENT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);
  return missing;
}

// Google OAuth 2.0 redirect-based flow (works when third-party cookies are blocked)
app.get("/auth/google", (req, res) => {
  const missing = checkGoogleOAuthEnvVars();
  if (missing.length > 0) {
    return res.status(503).json({
      error: "Google OAuth redirect flow not configured",
      message: `Missing environment variables: ${missing.join(", ")}`,
      hint: "Add GOOGLE_CLIENT_SECRET to your .env file. Optionally set GOOGLE_REDIRECT_URI (defaults to http://localhost:{PORT}/auth/callback/google)",
    });
  }

  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    prompt: "select_account",
    redirect_uri: google_redirect_uri,
  });
  res.redirect(authUrl);
});

// Google OAuth 2.0 callback endpoint
app.get("/auth/callback/google", async (req, res) => {
  const missing = checkGoogleOAuthEnvVars();
  if (missing.length > 0) {
    return res.status(503).json({
      error: "Google OAuth redirect flow not configured",
      message: `Missing environment variables: ${missing.join(", ")}`,
      hint: "Add GOOGLE_CLIENT_SECRET to your .env file. Optionally set GOOGLE_REDIRECT_URI (defaults to http://localhost:{PORT}/auth/callback/google)",
    });
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: "Authorization code not provided" });
  }

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauthClient.getToken({
      code,
      redirect_uri: google_redirect_uri,
    });
    oauthClient.setCredentials(tokens);

    // Verify the ID token and get user info
    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: google_client_id,
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;

    // Create or update user session
    if (!(email in auth)) {
      auth[email] = { priv: 0, token: "" };
    }
    if (auth[email].token) delete sessions[auth[email].token];

    let token = md5(new Date().toISOString() + email);
    sessions[token] = { user: auth[email] };
    sessions[token].username = name;
    sessions[token].email = email;
    sessions[token].google_data = payload;
    sessions[token].photoUrl = payload.picture;
    auth[email].token = token;
    loginCallback(sessions[token]);

    setAuthCookie(res, token);
    res.redirect("/");
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    res.status(500).json({ error: "Google authentication failed" });
  }
});

const MS_AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_URL = "https://graph.microsoft.com/v1.0/me";

// Helper to check Microsoft OAuth environment variables
function checkMicrosoftEnvVars() {
  const required = ["MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_REDIRECT_URI"];
  const missing = required.filter((key) => !process.env[key]);
  return missing;
}

// Step 1: Generate Microsoft Login URL
app.get("/auth/microsoft", (req, res) => {
  const missing = checkMicrosoftEnvVars();
  if (missing.length > 0) {
    return res.status(503).json({
      error: "Microsoft OAuth not configured",
      message: `Missing environment variables: ${missing.join(", ")}`,
      hint: "Add these variables to your .env file to enable Microsoft login",
    });
  }

  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MS_REDIRECT_URI,
    response_mode: "query",
    scope: "openid profile email User.Read",
  });
  res.redirect(`${MS_AUTH_URL}?${params}`);
});

app.get("/auth/callback/microsoft", async (req, res) => {
  const missing = checkMicrosoftEnvVars();
  if (missing.length > 0) {
    return res.status(503).json({
      error: "Microsoft OAuth not configured",
      message: `Missing environment variables: ${missing.join(", ")}`,
      hint: "Add these variables to your .env file to enable Microsoft login",
    });
  }

  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        code,
        redirect_uri: process.env.MS_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) {
      console.error("Token exchange failed:", tokenData);
      return res.status(401).json({ error: "Failed to fetch token" });
    }

    const { access_token, id_token } = tokenData;

    // Fetch user profile
    const profileResponse = await fetch(MS_GRAPH_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = await profileResponse.json();

    if (!profile.mail && !profile.userPrincipalName) {
      return res.status(400).json({ error: "Failed to retrieve user profile" });
    }

    const email = profile.mail || profile.userPrincipalName;
    const name = profile.displayName || email;

    // Fetch profile photo
    // let photoUrl = null;
    // try {
    //   const photoResponse = await fetch(`${MS_GRAPH_URL}/photo/$value`, {
    //     headers: { Authorization: `Bearer ${access_token}` },
    //   });

    //   if (photoResponse.ok) {
    //     const arrayBuffer = await photoResponse.arrayBuffer();
    //     photoUrl = `data:image/jpeg;base64,${Buffer.from(arrayBuffer).toString(
    //       "base64"
    //     )}`;
    //   }
    // } catch (err) {
    //   console.warn("No profile photo available for user:", email);
    // }

    if (!(email in auth)) {
      auth[email] = { priv: 0, token: "" };
    }
    if (auth[email].token) delete sessions[auth[email].token];

    const token = md5(new Date().toISOString() + email);
    sessions[token] = {
      user: auth[email],
      username: name,
      microsoft_data: profile,
      email,
      // photoUrl,
    };
    auth[email].token = token;
    loginCallback(sessions[token]);
    setAuthCookie(res, token);
    res.redirect("/");
  } catch (error) {
    console.error("Microsoft Sign-In error:", error);
    res.status(500).json({ error: "Microsoft authentication failed" });
  }
});

API.public(app);

app.use(function (req, res, next) {
  // Check cookie first, then fall back to Authorization header
  let token = req.cookies.auth_token;
  if (!token && req.headers.authorization) {
    token = req.headers.authorization;
    if (token.match(" ")) token = token.split(" ")[1];
  }
  if (!token) return res.status(403).json({ error: "No credentials Sent" });
  if (!(token in sessions))
    return res.status(403).json({ error: "Invalid Token" });
  req.session = sessions[token];
  next();
});

app.delete("/auth", (req, res) => {
  // Check cookie first, then fall back to Authorization header
  let token = req.cookies.auth_token;
  if (!token && req.headers.authorization) {
    token =
      req.headers.authorization.split(" ").length > 1
        ? req.headers.authorization.split(" ")[1]
        : req.headers.authorization;
  }
  if (!token || !(token in sessions)) {
    return res.status(403).json({ error: "Invalid Token" });
  }
  const username = sessions[token].username || sessions[token].email;
  if (username && auth[username]) {
    auth[username].token = "";
    saveAuth();
  }
  delete sessions[token];
  res.clearCookie("auth_token");
  res.json({ message: "Logged out successfully" });
});

// TEST with: request('/newuser',{method:'POST',body:JSON.stringify({username:'user2',password:'123456'})});
app.post("/newuser", (req, res) => {
  if (req.session.user.priv !== 1)
    res.status(403).json({ error: "You are not an admin" });
  let data = req.body;
  if (!data.priv) data.priv = 0;
  if (data.username && data.password) {
    auth[data.username] = {
      password: md5(data.password),
      priv: data.priv,
      token: "",
    };
    saveAuth();
  } else {
    res
      .status(400)
      .json({ message: "Username and Password must be specified" });
    return;
  }
  res.json({ message: "User created Successfully" });
});

API.private(app);
