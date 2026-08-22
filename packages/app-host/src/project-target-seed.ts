import type { ExtensionCatalogDocumentEntry } from "./extension-catalog-document.js";
import type { ExtensionTarget } from "./project-content-manifest.js";
import { parseProjectContentManifest, serializeProjectContentManifest } from "./project-content-manifest.js";

/**
 * The platform-compatibility target entry a registry target seeds into a
 * project's `targets` map: a caret range floored at the target package's
 * `packageVersion`.
 */
export function registryTargetEntry(packageVersion: string): ExtensionTarget {
  return { packageVersion: `^${packageVersion}` };
}

/**
 * Seed the `targets` section of a project's `wendoo.json` text from the single
 * registry target its `extensions` already declare, matching the section a New
 * Project of that target is created with, so the project resolves a hostable
 * target without a `wendoo.devTarget` override.
 *
 * Returns the manifest text with the compatibility-target entry added when the
 * project declares exactly one `"target"` coordinate from `targetEntries` in its
 * `extensions` and carries no `targets` entry for it. Returns the input text
 * unchanged when the manifest does not parse, declares no registry target,
 * declares more than one, or already carries a `targets` entry for the target.
 * All other manifest fields are preserved verbatim.
 *
 * @param manifestText - Serialized `wendoo.json` content to seed.
 * @param targetEntries - Registry entries whose `"target"` coordinates are
 *   eligible to be seeded.
 */
export function seedProjectTargets(
  manifestText: string,
  targetEntries: readonly Pick<ExtensionCatalogDocumentEntry, "coordinate" | "kind" | "version">[]
): string {
  const parsed = parseProjectContentManifest(manifestText);
  if (!parsed.ok) {
    return manifestText;
  }
  const { manifest } = parsed;
  const declared = new Set(Object.keys(manifest.extensions));
  const targets = targetEntries.filter(
    (candidate) => candidate.kind === "target" && declared.has(candidate.coordinate)
  );
  if (targets.length !== 1) {
    return manifestText;
  }
  const [target] = targets;
  if (manifest.targets?.[target.coordinate] !== undefined) {
    return manifestText;
  }
  return serializeProjectContentManifest({
    ...manifest,
    targets: { ...manifest.targets, [target.coordinate]: registryTargetEntry(target.version) },
  });
}
