#!/usr/bin/env node
/**
 * Smoke-loads the headless target adapter from dist-headless/ in plain Node and
 * checks the surface a host binds to: the createTargetAdapter export, and the
 * targetId plus manifest, modules, tileDocs, subjects, and run members of the
 * adapter it returns. Exits nonzero when the build output is missing, when the
 * artifact fails to import under Node, or when any of that surface is absent.
 * Run through `npm run build:headless`, which builds dist-headless/ first.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Members a host calls on the adapter object. */
const ADAPTER_METHODS = ["manifest", "modules", "tileDocs", "subjects", "run"];

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = join(appDir, "dist-headless", "rehearsal", "adapter.js");

/** Prints `message` under this script's name and exits nonzero. */
function fail(message) {
  console.error(`smoke-headless-adapter: ${message}`);
  process.exit(1);
}

if (!existsSync(entryPath)) {
  console.error(`smoke-headless-adapter: no adapter at ${entryPath}.`);
  console.error("Run `npm run build:headless` to build the adapter and smoke it.");
  process.exit(1);
}

let adapterModule;
try {
  adapterModule = await import(pathToFileURL(entryPath).href);
} catch (error) {
  fail(`${entryPath} does not import under Node: ${error instanceof Error ? error.stack : error}`);
}

if (typeof adapterModule.createTargetAdapter !== "function") {
  fail(`${entryPath} does not export createTargetAdapter.`);
}

const adapter = adapterModule.createTargetAdapter();
if (typeof adapter?.targetId !== "string" || adapter.targetId === "") {
  fail("the adapter it returns has no targetId.");
}

const missing = ADAPTER_METHODS.filter((name) => typeof adapter[name] !== "function");
if (missing.length > 0) {
  fail(`the "${adapter.targetId}" adapter is missing: ${missing.join(", ")}.`);
}

console.log(`smoked headless adapter: "${adapter.targetId}" loaded under Node with its full surface.`);
