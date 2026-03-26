import { Hono } from "hono";
import packageJson from "#package.json" with { type: "json" };

const health = new Hono();
const { name: packageName, version: packageVersion } = packageJson;

health.get("/health", (c) => {
  return c.json({
    status: "ok",
    packageName,
    packageVersion,
  });
});

export { health };
