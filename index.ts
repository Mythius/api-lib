import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { expose } from "./tools/listEndpoints.ts";
import {
  setupPublicRoutes as authPublic,
  setupMiddleware as authMiddleware,
  setupPrivateRoutes as authPrivate,
  setOnLoginCallback,
  setSessionStore,
} from "./tools/auth.ts";
import * as API from "./api.ts";

const app = new Hono();
expose(app);

app.use("/*", serveStatic({ root: "./public" }));
app.get("/health", (c) => c.json({ status: "ok" }));

setOnLoginCallback(API.onLogin);
// setSessionStore("redis");

// Public routes — no authentication required
authPublic(app);
API.publicRoutes(app);

// Auth middleware — all routes below require a valid session
authMiddleware(app);

// Private routes — authentication required
authPrivate(app);
API.privateRoutes(app);

export default {
  port: parseInt(process.env.PORT || "3000"),
  fetch: app.fetch,
};
