#!/usr/bin/env node
/**
 * Smoke-loads the headless target adapter from dist-headless/ in plain Node and
 * checks the adapter surface, the contract version, and the target identity it
 * reports against the identity this target's own mindcraft.json declares. Exits
 * nonzero when the build output is missing, or when the artifact does not load
 * and publish a conforming adapter.
 * Run through `npm run build:headless`, which builds dist-headless/ first.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkArtifactLoads } from "@mindcraft-lang/assistant-bridge/kit";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = join(appDir, "dist-headless", "rehearsal", "adapter.js");
const targetIdentity = JSON.parse(readFileSync(join(appDir, "target-package", "mindcraft.json"), "utf8")).identity;

if (!existsSync(entryPath)) {
  console.error(`smoke-headless-adapter: no adapter at ${entryPath}.`);
  console.error("Run `npm run build:headless` to build the adapter and smoke it.");
  process.exit(1);
}

const check = await checkArtifactLoads(pathToFileURL(entryPath), { targetIdentity });
if (!check.ok) {
  console.error(`smoke-headless-adapter: ${check.detail}`);
  process.exit(1);
}

console.log(`smoked headless adapter: ${targetIdentity} loaded under Node with its full surface.`);
