#!/usr/bin/env node

const { execSync } = require("node:child_process");

const apps = [
    "ecosim",
    "ecosim-rbx",
    "vscode-bridge",
    "vscode-extension",
];

for (const app of apps) {
    console.log(`Installing ${app}...`);
    execSync(`npm --prefix ${app} install`, { stdio: "inherit" });
}
