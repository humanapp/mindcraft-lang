import type { BrainServices } from "@mindcraft-lang/core/brain";
import { buildAmbientDeclarations } from "./ambient.js";
import {
  addSharedTileDeclarations,
  emptySharedTileSessionContext,
  type ProjectCompileResult,
  type SharedTileSessionContext,
  type SharedTileSessionContextDraft,
  UserTileProject,
} from "./project.js";
import type { AmbientFile } from "./types.js";

/** One compilation root of a multi-root session: a project's namespace and source files. */
export interface ProjectRoot {
  /** The root's project namespace: a host project's store id or an extension's origin. */
  namespace: string;
  /** The root's source files, keyed by workspace path. */
  files: ReadonlyMap<string, string>;
  /** Namespaces of roots this root depends on. Each must be present in the resolved set. */
  dependencies?: readonly string[];
}

/** Result of {@link MultiRootSession.compile}: per-root compile results keyed by namespace. */
export interface MultiRootCompileResult {
  /** Per-root results in dependency (compile) order. */
  roots: ReadonlyMap<string, ProjectCompileResult>;
}

/** Options for {@link MultiRootSession}. */
export interface MultiRootSessionOptions {
  /** The shared registry session every root compiles into. */
  services: BrainServices;
  /** Ordered ambient declaration files available to every root. Defaults to declarations built from the registry. */
  ambientFiles?: readonly AmbientFile[];
}

interface SessionRoot {
  root: ProjectRoot;
  project: UserTileProject;
  result?: ProjectCompileResult;
}

/**
 * Multi-root compilation session: compiles a resolved set of project roots --
 * each under its own namespace -- into one shared registry session, in
 * dependency order. Each root's registrations (types, tiles, Systems,
 * conversions) are keyed under its namespace; recompiling a root invalidates
 * and re-registers only that namespace, and removing a root from the set
 * clears its registrations.
 */
export class MultiRootSession {
  private readonly _options: MultiRootSessionOptions;
  private readonly _roots = new Map<string, SessionRoot>();
  private _order: string[] = [];
  private _ambient: readonly AmbientFile[] | undefined;

  constructor(options: MultiRootSessionOptions) {
    this._options = options;
  }

  /**
   * Replace the session's resolved set of roots. Roots keep their namespace
   * identity across calls; a root absent from the new set has its
   * registrations removed from the registry session. Throws on a duplicate
   * namespace, a dependency naming a namespace outside the set, or a
   * dependency cycle.
   */
  setRoots(roots: readonly ProjectRoot[]): void {
    const byNamespace = new Map<string, ProjectRoot>();
    for (const root of roots) {
      if (byNamespace.has(root.namespace)) {
        throw new Error(`Duplicate root namespace "${root.namespace}" in the resolved set`);
      }
      byNamespace.set(root.namespace, root);
    }
    for (const root of roots) {
      for (const dependency of root.dependencies ?? []) {
        if (!byNamespace.has(dependency)) {
          throw new Error(`Root "${root.namespace}" depends on "${dependency}", which is not in the resolved set`);
        }
      }
    }

    for (const namespace of [...this._roots.keys()]) {
      if (!byNamespace.has(namespace)) {
        this._options.services.runtime.types.removeUserTypes(namespace);
        this._roots.delete(namespace);
      }
    }

    this._order = sortByDependencies(roots);

    for (const root of roots) {
      let entry = this._roots.get(root.namespace);
      if (!entry) {
        const project = new UserTileProject({
          projectNamespace: root.namespace,
          services: this._options.services,
          ambientFiles: this._ambientFiles(),
        });
        entry = { root, project };
        this._roots.set(root.namespace, entry);
      } else {
        entry.root = root;
      }
      entry.project.setFiles(root.files);
    }
  }

  /** The session's namespaces in dependency (compile) order. */
  namespaces(): readonly string[] {
    return this._order;
  }

  /** The latest per-root compile results, keyed by namespace, in dependency order. */
  results(): ReadonlyMap<string, ProjectCompileResult> {
    const results = new Map<string, ProjectCompileResult>();
    for (const namespace of this._order) {
      const result = this._roots.get(namespace)?.result;
      if (result) {
        results.set(namespace, result);
      }
    }
    return results;
  }

  /**
   * Compile every root in dependency order into the shared registry session.
   * Each root's shared-tile reconcile sees the declarations of the roots
   * compiled before it, so shared `modifier.` / `parameter.` ids unify across
   * roots and disagreements diagnose in the later root.
   */
  compile(): MultiRootCompileResult {
    const draft = emptySharedTileSessionContext();
    for (const namespace of this._order) {
      const entry = this._roots.get(namespace)!;
      entry.result = entry.project.compileAll(contextView(draft));
      addSharedTileDeclarations(draft, entry.result.results, this._options.services);
    }
    return { roots: this.results() };
  }

  /**
   * Recompile one root by namespace, invalidating and re-registering only
   * that root's registrations. The root's reconcile sees the latest
   * declarations of the roots that precede it in dependency order. Throws
   * when `namespace` is not in the resolved set.
   */
  compileRoot(namespace: string): ProjectCompileResult {
    const entry = this._roots.get(namespace);
    if (!entry) {
      throw new Error(`Root "${namespace}" is not in the resolved set`);
    }
    const draft = emptySharedTileSessionContext();
    for (const priorNamespace of this._order) {
      if (priorNamespace === namespace) break;
      const prior = this._roots.get(priorNamespace)?.result;
      if (prior) {
        addSharedTileDeclarations(draft, prior.results, this._options.services);
      }
    }
    entry.result = entry.project.compileAll(contextView(draft));
    return entry.result;
  }

  private _ambientFiles(): readonly AmbientFile[] {
    if (!this._ambient) {
      this._ambient = this._options.ambientFiles ?? [
        { path: "ambient.d.ts", content: buildAmbientDeclarations(this._options.services.runtime.types) },
      ];
    }
    return this._ambient;
  }
}

function contextView(draft: SharedTileSessionContextDraft): SharedTileSessionContext {
  return {
    sharedModifiers: draft.sharedModifiers,
    sharedParameters: draft.sharedParameters,
    conversionPairs: draft.conversionPairs,
  };
}

/**
 * Order roots so every root follows its dependencies, preserving the input
 * order among roots whose dependencies are already satisfied. Throws on a
 * dependency cycle.
 */
function sortByDependencies(roots: readonly ProjectRoot[]): string[] {
  const dependencies = new Map<string, readonly string[]>();
  for (const root of roots) {
    dependencies.set(root.namespace, root.dependencies ?? []);
  }

  const order: string[] = [];
  const placed = new Set<string>();
  while (order.length < roots.length) {
    let progressed = false;
    for (const root of roots) {
      if (placed.has(root.namespace)) continue;
      if (dependencies.get(root.namespace)!.some((dependency) => !placed.has(dependency))) continue;
      order.push(root.namespace);
      placed.add(root.namespace);
      progressed = true;
    }
    if (!progressed) {
      const stuck = roots
        .filter((root) => !placed.has(root.namespace))
        .map((root) => root.namespace)
        .join(", ");
      throw new Error(`Dependency cycle among roots: ${stuck}`);
    }
  }
  return order;
}
