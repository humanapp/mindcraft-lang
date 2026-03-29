#!/usr/bin/env node

const { execSync } = require("node:child_process");

const packages = [
    "core",
    "ui",
    "docs",
    "typescript",
    "bridge-protocol",
    "bridge-client",
    "bridge-app",
];

for (const pkg of packages) {
    console.log(`Installing ${pkg}...`);
    execSync(`npm --prefix ${pkg} install`, { stdio: "inherit" });
}
