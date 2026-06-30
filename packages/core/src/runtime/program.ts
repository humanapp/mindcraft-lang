import type { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import type { List } from "../platform/list";
import type { UniqueSet } from "../platform/uniqueset";
import type { ConstantPools, FunctionBytecode } from "./bytecode";
import type { BytecodeExecutableAction } from "./context";
import type { TypeId } from "./type-defs";

/** One field of a program-local struct type: a field name and its numeric field id (storage slot). */
export interface ProgramStructField {
  /** The field's source name. */
  readonly name: string;
  /** The field's numeric id, which is also its storage slot. */
  readonly fieldIndex: number;
}

/**
 * One entry of a program's type table. Each entry describes one distinct type
 * the program references; child references (`elem`, `key`, `value`,
 * `members`, `params`, `result`, `base`) are table indices strictly less than
 * the entry's own index. Every entry carries its resolved {@link TypeId}
 * string for the TS runtime; the structural fields are the durable identity.
 */
export type ProgramTypeEntry =
  /** A core/target nominal type, identified by its stable type-atom id. */
  | { tag: "atom"; typeId: TypeId; atomId: number }
  /** A parameterized list type. */
  | { tag: "list"; typeId: TypeId; elem: number }
  /** A parameterized map type. */
  | { tag: "map"; typeId: TypeId; key: number; value: number }
  /** A union type; `members` follow the registry's canonical sorted order. */
  | { tag: "union"; typeId: TypeId; members: List<number> }
  /** A structural function type. */
  | { tag: "function"; typeId: TypeId; params: List<number>; result: number }
  /** A nullable wrapper around `base`. */
  | { tag: "nullable"; typeId: TypeId; base: number }
  /**
   * A program-local struct. Identity is the table position; `name` is the
   * registered type name (the `::`-qualified or anonymous compiler name).
   * `maxFieldId` is the highest declared field id, or -1 for a fieldless
   * struct; field storage holds `maxFieldId + 1` slots. `fields` is the field
   * name -> id map; it may be empty for a struct the program only accesses by
   * static field id.
   */
  | { tag: "struct"; typeId: TypeId; name: string; maxFieldId: number; fields: List<ProgramStructField> }
  /**
   * A program-local enum. `symbols` lists the enum's symbol keys in declared
   * order; enum values reference symbols by ordinal into this list.
   */
  | { tag: "enum"; typeId: TypeId; name: string; symbols: List<string> };

/**
 * Resolve a type-table index to its {@link TypeId} string. Throws if the
 * program has no type table or the index is out of range.
 */
export function resolveProgramTypeId(types: List<ProgramTypeEntry> | undefined, idx: number): TypeId {
  const entry = types?.get(idx);
  if (!entry) {
    throw new Error(`Type-table index ${idx} out of range (table size ${types ? types.size() : 0})`);
  }
  return entry.typeId;
}

/**
 * Return `entry` with every child table reference rewritten by `mapIdx`.
 * Returns the original entry object when no reference changes.
 */
export function remapProgramTypeEntry(entry: ProgramTypeEntry, mapIdx: (idx: number) => number): ProgramTypeEntry {
  switch (entry.tag) {
    case "atom":
    case "struct":
    case "enum":
      return entry;
    case "list": {
      const elem = mapIdx(entry.elem);
      return elem === entry.elem ? entry : { ...entry, elem };
    }
    case "map": {
      const key = mapIdx(entry.key);
      const value = mapIdx(entry.value);
      return key === entry.key && value === entry.value ? entry : { ...entry, key, value };
    }
    case "union": {
      let changed = false;
      const members = entry.members.map((m) => {
        const mapped = mapIdx(m);
        if (mapped !== m) changed = true;
        return mapped;
      });
      return changed ? { ...entry, members } : entry;
    }
    case "function": {
      let changed = false;
      const params = entry.params.map((p) => {
        const mapped = mapIdx(p);
        if (mapped !== p) changed = true;
        return mapped;
      });
      const result = mapIdx(entry.result);
      return changed || result !== entry.result ? { ...entry, params, result } : entry;
    }
    case "nullable": {
      const base = mapIdx(entry.base);
      return base === entry.base ? entry : { ...entry, base };
    }
  }
}

/**
 * One registered System (a user-code shared singleton) in a linked program.
 * The runtime runs `initFuncId` once at startup and `thinkFuncId` every think,
 * in registration order. State lives at `storeSlot` in the brain-global System
 * store (addressed by `LOAD_SYSTEM_VAR` / `STORE_SYSTEM_VAR`).
 */
export interface SystemRegistration {
  /** Display / debug name carried from the `System({ name })` config. */
  readonly name: string;
  /** Slot in the brain-global System store holding this System's state. */
  readonly storeSlot: number;
  /**
   * Function id run once at brain startup, before any rule or `think`. Builds
   * the initial state struct into `storeSlot` and runs the user `init`. Absent
   * when the System declares neither initial state nor an `init`.
   */
  readonly initFuncId?: number;
  /**
   * Function id run every think, after rule evaluation and before GC,
   * regardless of the active page. Absent when the System declares no `think`.
   */
  readonly thinkFuncId?: number;
}

/**
 * Compiled program. Constants are split into typed sub-pools for compactness
 * and ease of porting to fixed-size native vectors. See {@link ConstantPools}
 * for pool semantics.
 */
export interface Program {
  version: number;
  functions: List<FunctionBytecode>;
  constantPools: ConstantPools;
  /**
   * The program's type table. Typed instruction operands
   * (`LIST_NEW`/`MAP_NEW`/`STRUCT_NEW`/`STRUCT_COPY_EXCEPT` operand `b`,
   * `INSTANCE_OF` operand `a`) and `FunctionBytecode.injectCtxTypeIdx` are
   * indices into this table. Absent is treated as empty (valid only for
   * programs that reference no types).
   */
  types?: List<ProgramTypeEntry>;
  /** Named variable identifiers for cross-context variable access */
  variableNames: List<string>;
  entryPoint?: number;
  /**
   * Bytecode action bindings keyed by program-local action slot. Populated by
   * the linker for programs that contain `ACTION_CALL` / `ACTION_CALL_ASYNC`
   * instructions; absent on programs that have not been linked, and empty on
   * linked programs whose only action calls are host actions (those dispatch by
   * stable id via `HOST_ACTION_CALL` and carry no entry here).
   */
  actions?: List<BytecodeExecutableAction>;
  /**
   * Set of function ids that are rule entries. Membership identifies a
   * function as the body of a brain rule; non-members are regular bytecode
   * functions called from rule bodies. Backs
   * {@link IProgramServices.getRuleFuncIdForFunc}. Absent on programs that
   * have not been compiled from a brain definition (e.g. raw test
   * fixtures); treated as empty in that case.
   */
  ruleFuncIds?: UniqueSet<number>;
  /**
   * Mapping from a rule's funcId to its enclosing parent rule's funcId. A
   * rule with no enclosing rule (i.e. a root rule on a page) has no entry.
   * Backs the ancestor-walk semantics of
   * {@link IRuleVariableServices.getByName}: a read on a child rule resolves
   * up the ancestor chain when the variable is not present in the child's
   * own store. Absent on programs that have not been compiled from a brain
   * definition; treated as empty in that case.
   */
  ruleAncestors?: Dict<number, number>;
  /**
   * Registered Systems (user-code shared singletons) reachable from this
   * brain's used tiles. The runtime runs each entry's `initFuncId` once at
   * startup and `thinkFuncId` every think, in list order. Absent on programs
   * that reference no System; treated as empty in that case.
   */
  systems?: List<SystemRegistration>;
}

/**
 * One System referenced by a single user-tile artifact, with program-local ids
 * the linker remaps. `identity` is the cross-module store key; the linker maps
 * it to one brain-global store slot and registers each System once across all
 * artifacts that reference it.
 */
export interface ArtifactSystem {
  /** Stable cross-module identity (`<declaring-file>::<binding-name>`). */
  readonly identity: string;
  /** Display / debug name from the `System({ name })` config. */
  readonly name: string;
  /** Artifact-local System store slot (operand of `LOAD_SYSTEM_VAR` / `STORE_SYSTEM_VAR`). */
  readonly localSlot: number;
  /** Artifact-local func id of the generated init wrapper. */
  readonly initFuncId: number;
  /** Artifact-local func id of the generated think wrapper, if a `think` is declared. */
  readonly thinkFuncId?: number;
}

/**
 * Program plus the metadata needed to invoke a single user-authored action.
 * Returned by the user-tile compiler; consumed by the linker to splice the
 * action's functions and constants into a host brain program.
 */
export interface ProgramArtifact extends Program {
  entryFuncId: number;
  /**
   * Optional one-time initializer body for the action. Linked into
   * {@link BytecodeExecutableAction.initializerFuncId}; runs once per
   * `(brainInstance, callSiteId)`.
   */
  initializerFuncId?: number;
  /**
   * Optional per-page-activation entry hook. Linked into
   * {@link BytecodeExecutableAction.activationFuncId}; runs every time the
   * owning page is activated.
   */
  activationFuncId?: number;
  /**
   * Optional per-page-deactivation hook. Linked into
   * {@link BytecodeExecutableAction.deactivationFuncId}; runs every time
   * the owning page is deactivated, before fiber cancellation.
   */
  deactivationFuncId?: number;
  numStateSlots: number;
  isAsync: boolean;
  revisionId: string;
  /**
   * Systems referenced by this artifact, each with artifact-local ids the
   * linker remaps and registers (once per identity) across all artifacts.
   * Absent / empty when the artifact references no System.
   */
  artifactSystems?: List<ArtifactSystem>;
}
