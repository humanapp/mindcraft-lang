import type { BrainServices } from "@wendoo/core/brain";
import { CompileDiagCode, MultiRootSession, type ProjectRoot } from "@wendoo/ts-compiler";
import type { EmbeddedExtension } from "./embedded-extensions.js";
import { resolveProjectExtensions } from "./embedded-extensions.js";

/**
 * A declaration in a repo-embedded extension that ships without an explicit
 * stable `id`. Read-only extension source is regenerated on load, so the
 * compiler cannot mint and persist an id for it; the id must be present in the
 * bundled source.
 */
export interface EmbeddedExtensionIdViolation {
  /** The `<owner>/<repo>` coordinate of the extension whose source is missing an id. */
  coordinate: string;
  /** The extension-relative path of the file declaring the id-less tile. */
  path: string;
  /** The compiler's diagnostic message, naming the declaration kind and name. */
  message: string;
}

/**
 * Compile every extension in `embedRecord` as read-only roots and collect each
 * declared Sensor, Actuator, or Conversion that ships without an explicit
 * stable `id`. Systems carry no explicit id (their identity is structural) and
 * are never reported. Returns an empty array when every declaration carries an
 * id.
 *
 * The compile mirrors how a consuming project mounts these extensions: each
 * origin's transitive closure is resolved from the record, and every origin is
 * compiled under its own coordinate namespace into `services`. Supply a
 * `services` built with the app's modules so the ambient the extensions compile
 * against matches the app's platform.
 */
export function findEmbeddedExtensionsMissingStableIds(
  embedRecord: readonly EmbeddedExtension[],
  services: BrainServices
): EmbeddedExtensionIdViolation[] {
  const references: Record<string, string> = {};
  for (const extension of embedRecord) {
    references[extension.canonicalOrigin] = `embedded:${extension.canonicalOrigin}`;
  }
  const { dependencyMounts } = resolveProjectExtensions(references, { embedded: embedRecord });
  const roots: ProjectRoot[] = dependencyMounts.map((mount) => ({
    namespace: mount.namespace,
    files: mount.files,
    dependencies: mount.dependencies,
    readOnlySource: true,
  }));

  const session = new MultiRootSession({ services });
  session.setRoots(roots);
  const { roots: results } = session.compile();

  const violations: EmbeddedExtensionIdViolation[] = [];
  for (const [coordinate, result] of results) {
    for (const [path, compileResult] of result.results) {
      for (const diagnostic of compileResult.diagnostics) {
        if (diagnostic.code === CompileDiagCode.ExtensionDeclarationMissingId) {
          violations.push({ coordinate, path, message: diagnostic.message });
        }
      }
    }
  }
  return violations;
}

/**
 * Render {@link EmbeddedExtensionIdViolation}s as an author-facing failure
 * message that names each offending extension coordinate and file and states
 * how to obtain a stable id. Use it as the assertion message of a build gate
 * over an app's embedded extensions.
 */
export function formatEmbeddedExtensionIdViolations(violations: readonly EmbeddedExtensionIdViolation[]): string {
  const lines = violations.map((v) => `  ${v.coordinate} (${v.path}): ${v.message}`);
  return (
    "Repo-embedded extension(s) ship a declaration without an explicit stable id:\n" +
    `${lines.join("\n")}\n` +
    "To obtain an id, compile the extension as a writable project to mint one, " +
    "then set that id explicitly in the declaration's source."
  );
}
