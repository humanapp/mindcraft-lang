#!/usr/bin/env node

const { execSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

const appsDir = resolve(__dirname, "..");

const apps = readdirSync(appsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(appsDir, entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

for (const app of apps) {
  console.log(`Installing ${app}...`);
  execSync(`npm --prefix "${join(appsDir, app)}" install`, { stdio: "inherit" });
}
