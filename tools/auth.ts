import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import Redis from "ioredis";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || "3000";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${PORT}/auth/callback/google`;

const CAS_SERVER_URL = process.env.CAS_SERVER_URL || null;
const CAS_CLIENT_ID = process.env.CAS_CLIENT_ID || null;
const CAS_CALLBACK_URL =
  process.env.CAS_CALLBACK_URL || `http://localhost:${PORT}/auth/callback/cas`;

const MS_AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_URL = "https://graph.microsoft.com/v1.0/me";

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface User {
  priv: number;
  token: string;
  password?: string;
}

export interface Session {
  user: User;
  username?: string;
  email?: string;
  google_data?: Record<string, unknown>;
  microsoft_data?: Record<string, unknown>;
  cas_data?: Record<string, unknown>;
  photoUrl?: string | null;
  db?: any | null;
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------
interface SessionStore {
  get(token: string): Promise<Session | null>;
  set(token: string, session: Session): Promise<void>;
  delete(token: string): Promise<void>;
  has(token: string): Promise<boolean>;
}

class MemoryStore implements SessionStore {
  private data: Record<string, Session> = {};

  async get(token: string) {
    return this.data[token] ?? null;
  }
  async set(token: string, session: Session) {
    this.data[token] = session;
  }
  async delete(token: string) {
    delete this.data[token];
  }
  async has(token: string) {
    return token in this.data;
  }
}

class RedisStore implements SessionStore {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  }

  private key(token: string) {
    return `session:${token}`;
  }

  async get(token: string) {
    const data = await this.redis.get(this.key(token));
    return data ? (JSON.parse(data) as Session) : null;
  }
  async set(token: string, session: Session) {
    await this.redis.set(
      this.key(token),
      JSON.stringify(session),
      "EX",
      SESSION_TTL,
    );
  }
  async delete(token: string) {
    await this.redis.del(this.key(token));
  }
  async has(token: string) {
    return (await this.redis.exists(this.key(token))) > 0;
  }
}

let store: SessionStore = new MemoryStore();

export function setSessionStore(type: "memory" | "redis"): void {
  store = type === "redis" ? new RedisStore() : new MemoryStore();
}

// ---------------------------------------------------------------------------
// Auth state (user accounts, persisted to auth.json)
// ---------------------------------------------------------------------------
let auth: Record<string, User> = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function md5(str: string): string {
  return new Bun.CryptoHasher("md5").update(str).digest("hex");
}

function setAuthCookie(c: any, token: string): void {
  setCookie(c, "auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: SESSION_TTL,
  });
}

async function loadAuth(): Promise<void> {
  try {
    const text = await Bun.file("auth.json").text();
    auth = JSON.parse(text);
  } catch {
    await Bun.write("auth.json", "{}");
  }
}

function saveAuth(): void {
  Bun.write("auth.json", JSON.stringify(auth));
}

let onLoginCallback: ((session: Session) => void) | null = null;

export function setOnLoginCallback(cb: (session: Session) => void): void {
  onLoginCallback = cb;
}

async function loginCallback(session: Session): Promise<void> {
  saveAuth();
  if (onLoginCallback) await onLoginCallback(session);
}

// ---------------------------------------------------------------------------
// Google OAuth helpers (no external dependency — uses Google REST APIs)
// ---------------------------------------------------------------------------
async function verifyGoogleToken(
  idToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
  );
  if (!res.ok) throw new Error("Invalid Google token");
  const data = (await res.json()) as Record<string, unknown>;
  if (data.aud !== GOOGLE_CLIENT_ID) throw new Error("Token audience mismatch");
  return data;
}

function checkGoogleOAuthEnvVars(): string[] {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter(
    (key) => !process.env[key],
  );
}

function checkMicrosoftEnvVars(): string[] {
  return ["MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_REDIRECT_URI"].filter(
    (key) => !process.env[key],
  );
}

// ---------------------------------------------------------------------------
// Public auth routes (no authentication required)
// ---------------------------------------------------------------------------
export function setupPublicRoutes(app: Hono): void {
  app.post("/auth", async (c) => {
    try {
      const cred = await c.req.json<{ username: string; password: string }>();
      if (!(cred.username in auth)) {
        await loadAuth();
      }
      if (!(cred.username in auth)) {
        return c.json({ error: "Couldn't log in" }, 403);
      }
      if (md5(cred.password) === auth[cred.username].password) {
        const token = md5(new Date().toISOString() + cred.username);
        await store.delete(auth[cred.username].token);
        const session: Session = {
          user: auth[cred.username],
          username: cred.username,
        };
        await store.set(token, session);
        auth[cred.username].token = token;
        setAuthCookie(c, token);
        return c.json({ message: "Successfully Logged In" });
      } else {
        return c.json({ error: "Couldn't log in" }, 403);
      }
    } catch (e) {
      console.warn(e);
      return c.json({ error: String(e) }, 403);
    }
  });

  app.post("/auth/google-oneclick", async (c) => {
    try {
      const cred = await c.req.json<{
        credential: string;
        email: string;
        name: string;
      }>();
      const data = await verifyGoogleToken(cred.credential);
      if (!(cred.email in auth)) {
        auth[cred.email] = { priv: 0, token: "" };
      }
      await store.delete(auth[cred.email].token);
      const token = md5(new Date().toISOString() + cred.email);
      const session: Session = {
        user: auth[cred.email],
        username: cred.name,
        email: data.email as string,
        google_data: data,
        photoUrl: data.picture as string,
      };
      await store.set(token, session);
      auth[cred.email].token = token;
      await loginCallback(session);
      setAuthCookie(c, token);
      return c.json({ message: "Successfully Logged In" }, 200);
    } catch (e) {
      console.error(e);
      return c.json({ error: "Invalid Google Login" }, 403);
    }
  });

  app.get("/auth/google", (c) => {
    if (CAS_SERVER_URL && CAS_CLIENT_ID) {
      const params = new URLSearchParams({
        client_id: CAS_CLIENT_ID,
        redirect_uri: CAS_CALLBACK_URL,
      });
      return c.redirect(`${CAS_SERVER_URL}/auth/google?${params}`);
    }
    const missing = checkGoogleOAuthEnvVars();
    if (missing.length > 0) {
      return c.json(
        {
          error: "Google OAuth redirect flow not configured",
          message: `Missing environment variables: ${missing.join(", ")}`,
          hint: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.",
        },
        503,
      );
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ].join(" "),
      access_type: "offline",
      prompt: "select_account",
    });
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/auth/callback/google", async (c) => {
    const missing = checkGoogleOAuthEnvVars();
    if (missing.length > 0) {
      return c.json(
        {
          error: "Google OAuth redirect flow not configured",
          message: `Missing environment variables: ${missing.join(", ")}`,
          hint: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.",
        },
        503,
      );
    }
    const code = c.req.query("code");
    if (!code) {
      return c.json({ error: "Authorization code not provided" }, 400);
    }
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = (await tokenRes.json()) as {
        id_token: string;
        error?: string;
      };
      if (tokenData.error) throw new Error(tokenData.error);

      const payload = await verifyGoogleToken(tokenData.id_token);
      const email = payload.email as string;
      const name = payload.name as string;

      if (!(email in auth)) {
        auth[email] = { priv: 0, token: "" };
      }
      await store.delete(auth[email].token);

      const token = md5(new Date().toISOString() + email);
      const session: Session = {
        user: auth[email],
        username: name,
        email,
        google_data: payload,
        photoUrl: payload.picture as string,
      };
      await store.set(token, session);
      auth[email].token = token;
      await loginCallback(session);
      setAuthCookie(c, token);
      return c.redirect("/");
    } catch (error) {
      console.error("Google OAuth callback error:", error);
      return c.json({ error: "Google authentication failed" }, 500);
    }
  });

  app.get("/auth/microsoft", (c) => {
    if (CAS_SERVER_URL && CAS_CLIENT_ID) {
      const params = new URLSearchParams({
        client_id: CAS_CLIENT_ID,
        redirect_uri: CAS_CALLBACK_URL,
      });
      return c.redirect(`${CAS_SERVER_URL}/auth/microsoft?${params}`);
    }
    const missing = checkMicrosoftEnvVars();
    if (missing.length > 0) {
      return c.json(
        {
          error: "Microsoft OAuth not configured",
          message: `Missing environment variables: ${missing.join(", ")}`,
          hint: "Add these variables to your .env file to enable Microsoft login",
        },
        503,
      );
    }
    const params = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      response_type: "code",
      redirect_uri: process.env.MS_REDIRECT_URI!,
      response_mode: "query",
      scope: "openid profile email User.Read",
    });
    return c.redirect(`${MS_AUTH_URL}?${params}`);
  });

  app.get("/auth/callback/microsoft", async (c) => {
    const missing = checkMicrosoftEnvVars();
    if (missing.length > 0) {
      return c.json(
        {
          error: "Microsoft OAuth not configured",
          message: `Missing environment variables: ${missing.join(", ")}`,
          hint: "Add these variables to your .env file to enable Microsoft login",
        },
        503,
      );
    }
    const code = c.req.query("code");
    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }
    try {
      const tokenResponse = await fetch(MS_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MS_CLIENT_ID!,
          client_secret: process.env.MS_CLIENT_SECRET!,
          code,
          redirect_uri: process.env.MS_REDIRECT_URI!,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        id_token: string;
        error?: string;
      };
      if (tokenData.error) {
        console.error("Token exchange failed:", tokenData);
        return c.json({ error: "Failed to fetch token" }, 401);
      }

      const profileResponse = await fetch(MS_GRAPH_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = (await profileResponse.json()) as {
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
        [key: string]: unknown;
      };
      if (!profile.mail && !profile.userPrincipalName) {
        return c.json({ error: "Failed to retrieve user profile" }, 400);
      }

      const email = (profile.mail || profile.userPrincipalName) as string;
      const name = profile.displayName || email;

      if (!(email in auth)) {
        auth[email] = { priv: 0, token: "" };
      }
      await store.delete(auth[email].token);

      const token = md5(new Date().toISOString() + email);
      const session: Session = {
        user: auth[email],
        username: name,
        microsoft_data: profile,
        email,
      };
      await store.set(token, session);
      auth[email].token = token;
      await loginCallback(session);
      setAuthCookie(c, token);
      return c.redirect("/");
    } catch (error) {
      console.error("Microsoft Sign-In error:", error);
      return c.json({ error: "Microsoft authentication failed" }, 500);
    }
  });

  app.get("/auth/callback/cas", async (c) => {
    if (!CAS_SERVER_URL) {
      return c.json({ error: "CAS is not configured on this server" }, 503);
    }
    const casToken = c.req.query("token");
    if (!casToken) {
      return c.json({ error: "Missing token from CAS" }, 400);
    }
    try {
      const verifyRes = await fetch(`${CAS_SERVER_URL}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: casToken }),
      });
      const {
        valid,
        user,
        error: verifyError,
      } = (await verifyRes.json()) as {
        valid: boolean;
        user?: {
          email: string;
          name: string;
          picture?: string;
          [key: string]: unknown;
        };
        error?: string;
      };
      if (!valid || !user) {
        console.error("CAS token verification failed:", verifyError);
        return c.json({ error: "Invalid CAS token" }, 403);
      }

      const email = user.email;
      if (!(email in auth)) {
        auth[email] = { priv: 0, token: "" };
      }
      await store.delete(auth[email].token);

      const token = md5(new Date().toISOString() + email);
      const session: Session = {
        user: auth[email],
        username: user.name,
        email,
        photoUrl: user.picture || null,
        cas_data: user,
      };
      await store.set(token, session);
      auth[email].token = token;
      await loginCallback(session);
      setAuthCookie(c, token);
      return c.redirect("/");
    } catch (err) {
      console.error("CAS callback error:", (err as Error).message);
      return c.json({ error: "CAS authentication failed" }, 500);
    }
  });
}

// ---------------------------------------------------------------------------
// Auth middleware — gates all routes registered after it
// ---------------------------------------------------------------------------
export function setupMiddleware(app: Hono): void {
  app.use("*", async (c, next) => {
    let token = getCookie(c, "auth_token");
    if (!token) {
      const authHeader = c.req.header("authorization");
      if (authHeader) {
        token = authHeader.includes(" ")
          ? authHeader.split(" ")[1]
          : authHeader;
      }
    }
    if (!token) return c.json({ error: "No credentials Sent" }, 403);
    const session = await store.get(token);
    if (!session) return c.json({ error: "Invalid Token" }, 403);
    (c as any).set("session", session);
    await next();
  });
}

// ---------------------------------------------------------------------------
// Private auth routes (require authentication)
// ---------------------------------------------------------------------------
export function setupPrivateRoutes(app: Hono): void {
  app.delete("/auth", async (c) => {
    let token = getCookie(c, "auth_token");
    if (!token) {
      const authHeader = c.req.header("authorization");
      if (authHeader) {
        token = authHeader.includes(" ")
          ? authHeader.split(" ")[1]
          : authHeader;
      }
    }
    if (!token || !(await store.has(token))) {
      return c.json({ error: "Invalid Token" }, 403);
    }
    const session = await store.get(token);
    const username = session?.username || session?.email;
    if (username && auth[username]) {
      auth[username].token = "";
      saveAuth();
    }
    await store.delete(token);
    deleteCookie(c, "auth_token");
    return c.json({ message: "Logged out successfully" });
  });

  app.post("/newuser", async (c) => {
    const session = (c as any).get("session") as Session;
    if (session.user.priv !== 1) {
      return c.json({ error: "You are not an admin" }, 403);
    }
    const data = await c.req.json<{
      username?: string;
      password?: string;
      priv?: number;
    }>();
    if (!data.priv) data.priv = 0;
    if (data.username && data.password) {
      auth[data.username] = {
        password: md5(data.password),
        priv: data.priv,
        token: "",
      };
      saveAuth();
    } else {
      return c.json(
        { message: "Username and Password must be specified" },
        400,
      );
    }
    return c.json({ message: "User created Successfully" });
  });
}
