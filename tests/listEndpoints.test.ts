import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { expose } from "../tools/listEndpoints.ts";

describe("expose", () => {
  test("GET /endpoints/json lists every registered route", async () => {
    const app = new Hono();
    expose(app);
    app.get("/foo", (c) => c.text("foo"));
    app.post("/bar", (c) => c.text("bar"));

    const res = await app.request("/endpoints/json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/endpoints/json" },
        { method: "GET", path: "/endpoints/html" },
        { method: "GET", path: "/foo" },
        { method: "POST", path: "/bar" },
      ]),
    );
  });

  test("GET /endpoints/html renders an HTML table of the routes", async () => {
    const app = new Hono();
    expose(app);
    app.get("/foo", (c) => c.text("foo"));

    const res = await app.request("/endpoints/html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("/foo");
  });
});
