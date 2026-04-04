import { List } from "@mindcraft-lang/core";
import type { BrainActionResolver } from "@mindcraft-lang/core/brain";
import { type ActionDescriptor, getBrainServices, type IBrain, type IBrainDef } from "@mindcraft-lang/core/brain";
import { Brain } from "@mindcraft-lang/core/brain/runtime";
import type { UserAuthoredProgram } from "@mindcraft-lang/typescript";

export interface ActiveBrainContainer {
  rebuildBrainsUsingChangedActions(changedRevisions: ReadonlyMap<string, string>): void;
}

const userActionArtifacts = new Map<string, UserAuthoredProgram>();
const activeBrainContainers = new Set<ActiveBrainContainer>();
const brainActionRevisions = new WeakMap<IBrain, ReadonlyMap<string, string>>();

function stableStringify(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === undefined) {
    return '"__undefined__"';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const listLike = value as { toArray?: () => unknown[] };
    if (typeof listLike.toArray === "function") {
      return stableStringify(listLike.toArray());
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }

  return JSON.stringify(String(value));
}

function hashString(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeUserActionArtifact(program: UserAuthoredProgram): UserAuthoredProgram {
  const signature = stableStringify({
    key: program.key,
    kind: program.kind,
    name: program.name,
    callSpec: program.callDef.callSpec,
    params: program.params,
    outputType: program.outputType,
    isAsync: program.isAsync,
    numStateSlots: program.numStateSlots,
    entryFuncId: program.entryFuncId,
    activationFuncId: program.activationFuncId,
    functions: program.functions.toArray(),
    constants: program.constants.toArray(),
    variableNames: program.variableNames.toArray(),
  });

  return {
    ...program,
    revisionId: `artifact-${hashString(signature)}`,
  };
}

function buildUserActionDescriptor(program: UserAuthoredProgram): ActionDescriptor {
  return {
    key: program.key,
    kind: program.kind,
    callDef: program.callDef,
    isAsync: program.isAsync,
    outputType: program.outputType,
  };
}

function createActionResolver(): BrainActionResolver {
  return {
    resolveAction(descriptor) {
      const program = userActionArtifacts.get(descriptor.key);
      if (program) {
        if (program.kind !== descriptor.kind || program.isAsync !== descriptor.isAsync) {
          return undefined;
        }

        return {
          binding: "bytecode",
          descriptor: buildUserActionDescriptor(program),
          artifact: program,
        };
      }

      return getBrainServices().actions.resolveAction(descriptor);
    },
  };
}

function createTrackingResolver(revisions: Map<string, string>): BrainActionResolver {
  const resolver = createActionResolver();
  return {
    resolveAction(descriptor) {
      const resolved = resolver.resolveAction(descriptor);
      if (resolved?.binding === "bytecode") {
        revisions.set(resolved.descriptor.key, resolved.artifact.revisionId);
      }
      return resolved;
    },
  };
}

export function createSimBrain(brainDef: IBrainDef, contextData?: unknown): IBrain {
  const services = getBrainServices();
  const revisions = new Map<string, string>();
  const brain = new Brain(brainDef, {
    catalogs: List.from([services.tiles, brainDef.catalog()]),
    actionResolver: createTrackingResolver(revisions),
  });
  brain.initialize(contextData);
  brainActionRevisions.set(brain, revisions);
  return brain;
}

export function publishUserActionArtifacts(programs: readonly UserAuthoredProgram[]): Map<string, string> {
  const changedRevisions = new Map<string, string>();

  for (const rawProgram of programs) {
    const program = normalizeUserActionArtifact(rawProgram);
    const current = userActionArtifacts.get(program.key);
    if (!current || current.revisionId !== program.revisionId) {
      changedRevisions.set(program.key, program.revisionId);
    }
    userActionArtifacts.set(program.key, program);
  }

  return changedRevisions;
}

export function deleteUserActionArtifacts(keys: Iterable<string>): void {
  for (const key of keys) {
    userActionArtifacts.delete(key);
  }
}

export function registerActiveBrainContainer(container: ActiveBrainContainer): () => void {
  activeBrainContainers.add(container);
  return () => {
    activeBrainContainers.delete(container);
  };
}

export function shouldRebuildBrain(brain: IBrain, changedRevisions: ReadonlyMap<string, string>): boolean {
  const currentRevisions = brainActionRevisions.get(brain);
  if (!currentRevisions || currentRevisions.size === 0) {
    return false;
  }

  for (const [key, revisionId] of changedRevisions) {
    const currentRevision = currentRevisions.get(key);
    if (currentRevision !== undefined && currentRevision !== revisionId) {
      return true;
    }
  }

  return false;
}

export function rebuildActiveBrainsUsingChangedActions(changedRevisions: ReadonlyMap<string, string>): void {
  if (changedRevisions.size === 0) {
    return;
  }

  for (const container of activeBrainContainers) {
    container.rebuildBrainsUsingChangedActions(changedRevisions);
  }
}
