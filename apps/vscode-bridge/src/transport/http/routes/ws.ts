import { Hono } from "hono";

const ws = new Hono();

// Future API routes will be mounted here.

ws.get("/", (c) => {
  return c.json({ api: "ws" });
});

export { ws };
