import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Directory of a target app holding its ready-to-publish package. */
const packageDirName = "target-package";

/** File the target package's manifest is kept in. */
const manifestFileName = "wendoo.json";

/**
 * Path of the manifest the target app at `appDir` publishes.
 *
 * @param appDir Absolute path of the target app directory.
 */
export function targetManifestPath(appDir: string): string {
  return join(appDir, packageDirName, manifestFileName);
}

/**
 * The identity the target app at `appDir` declares in its published manifest.
 * Throws when the manifest is absent or unparsable, and when it declares no
 * non-empty identity.
 *
 * @param appDir Absolute path of the target app directory.
 */
export function readTargetIdentity(appDir: string): string {
  const path = targetManifestPath(appDir);
  const { identity } = JSON.parse(readFileSync(path, "utf8")) as { identity?: unknown };
  if (typeof identity !== "string" || identity.length === 0) {
    throw new Error(`${path} declares no identity.`);
  }
  return identity;
}
