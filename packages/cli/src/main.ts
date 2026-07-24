#!/usr/bin/env node
import { maybeRedirectToLocalBuild } from "./local-redirect.js";

if (!(await maybeRedirectToLocalBuild())) {
  const { runCli } = await import("./cli.js");
  process.exitCode = await runCli(process.argv.slice(2));
}
