#!/usr/bin/env node
/**
 * Assembles the ready-to-publish target package: recreates target-package/app/
 * as a copy of the app's dist/ build output, then rewrites the hostApp field of
 * target-package/mindcraft.json to declare the copied bundle and stamps the
 * buildVersion field with the version the bundle was just baked at. Every other
 * manifest field is preserved. Fails with a nonzero exit when dist/ is missing
 * or empty. Run through `npm run package`, which builds dist/ first.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(appDir, "dist");
const packageDir = join(appDir, "target-package");
const bundleDir = join(packageDir, "app");
const manifestPath = join(packageDir, "mindcraft.json");

if (!existsSync(distDir) || readdirSync(distDir).length === 0) {
  console.error(`assemble-target-package: no build output in ${distDir}.`);
  console.error("Run `npm run package` to build the app and assemble the package.");
  process.exit(1);
}

rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });
cpSync(distDir, bundleDir, { recursive: true });

/** Lists every file under `dir` as a forward-slash path relative to `dir`. */
function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listFiles(join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

// hostApp.files entries are content-relative: each bundle file is listed at
// the path the published repository carries it, under the hostApp path.
const files = listFiles(bundleDir)
  .sort()
  .map((path) => `app/${path}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.hostApp = { path: "app", files };
// The build-version stamp records the version vite baked into the bundle
// moments earlier. It is manifest.version here, so a later version bump that is
// not followed by a repackage leaves this stamp behind and publish refuses.
// The "buildVersion" field name must match the stamp field publish reads.
manifest.buildVersion = manifest.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`assembled target package: ${files.length} files under target-package/app/`);
