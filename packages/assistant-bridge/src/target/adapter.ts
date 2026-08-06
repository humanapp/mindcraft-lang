import type { IBrainDef, MindcraftModule } from "@mindcraft-lang/core/app";

/**
 * Version of the adapter contract this package defines. A loader compares it
 * against the version an artifact was built with and refuses a mismatch.
 * Increment it whenever {@link TargetAdapter} or the shapes it exchanges change
 * in a way an already-built artifact cannot satisfy.
 */
export const ADAPTER_CONTRACT_VERSION = 2;

/** Facts about a target world that a session states to the model before it plans. */
export interface TargetManifest {
  /** Target platform name, as the model should read it. */
  readonly target: string;
  /**
   * What the person is programming, as a noun phrase the prompt reads inline,
   * for example "their creature".
   */
  readonly thing: string;
  /** What the target's body provides, one plain sentence per entry. */
  readonly provides: readonly string[];
}

/**
 * One scripted percept a scenario delivers into the staged world. The target's
 * adapter interprets it; nothing here presumes what a kind senses.
 */
export interface ScenarioInput {
  /** What is delivered, from {@link TargetAdapter.inputKinds}. */
  readonly kind: string;
  /** Zero-based think this input is applied before. */
  readonly at: number;
  /** Level `kind` is set to, holding until another entry of the same kind changes it. */
  readonly value: number | boolean;
}

/**
 * The staged world one rehearsal runs: the core scenario shape every target
 * shares. A target extends it by registering its own input kinds; the seed and
 * the subject are always present.
 */
export interface SimulationScenario {
  /** Seed for every random choice the run makes; the same seed reproduces the run exactly. */
  readonly seed: number;
  /** Population role the brain under study drives, from {@link TargetAdapter.subjects}. */
  readonly subject: string;
  /**
   * Percepts the run scripts, in any order; the run delivers each at its own
   * `at`. Absent when the run scripts none.
   */
  readonly inputs?: readonly ScenarioInput[];
}

/** One rehearsal request. */
export interface SimulationRequest {
  /** Brain the subject role executes for this run. */
  readonly brainDef: IBrainDef;
  readonly scenario: SimulationScenario;
  /** Number of fixed-step thinks to run. */
  readonly thinks: number;
}

/** One rule's WHEN gate on one think. */
export interface GateObservation {
  /** Rule id in `pageIndex/ruleIndex[/childIndex...]` form. */
  readonly ruleId: string;
  /** `true` when the gate passed and the rule's DO section ran. */
  readonly fired: boolean;
  /** The value the WHEN section produced, rendered compactly. */
  readonly result: string;
}

/** One host action the brain under study dispatched on one think. */
export interface DispatchObservation {
  /** Stable action key, for example `actuator.move`. */
  readonly action: string;
  /**
   * The arguments the call carried, rendered as `name=value` for every argument
   * slot the call filled, in slot order. Empty when the call filled none.
   */
  readonly args: readonly string[];
  /** Rule the dispatch was attributed to, absent when the runtime could not attribute it. */
  readonly ruleId?: string;
}

/** Everything observed of the brain under study during one think. */
export interface ThinkObservation {
  readonly gates: readonly GateObservation[];
  readonly dispatches: readonly DispatchObservation[];
}

/** What the staged world looked like, independent of the brain under study. */
export interface WorldObservation {
  /** Brain-driven participants standing when the run started. */
  readonly initialPopulation: number;
  /** Brain-driven participants standing when the run ended. */
  readonly finalPopulation: number;
  /** Distinct brains that executed during the run, the subject's included. */
  readonly brainsExecuted: number;
}

/** One completed rehearsal. */
export interface SimulationRun {
  /** Thinks the subject actually executed; at most the requested count. */
  readonly thinks: number;
  /** One entry per executed think, in order. */
  readonly observations: readonly ThinkObservation[];
  readonly world: WorldObservation;
}

/**
 * Everything a harness needs of a target to author for it: what to tell the
 * model about the world, what to install so the editor's tools see the world's
 * tiles, the documentation those tiles carry, and how to rehearse a brain in
 * the world headlessly.
 *
 * An artifact publishing an adapter exports a `createTargetAdapter` function
 * returning one.
 */
export interface TargetAdapter {
  /**
   * Contract version the artifact was built against; a loader refuses a value
   * other than the {@link ADAPTER_CONTRACT_VERSION} it holds.
   */
  readonly contractVersion: number;
  /** Name of the package this artifact was built from, injected at build time. */
  readonly packageName: string;
  /** Facts about this world, stated to the model before it plans. */
  manifest(): TargetManifest;
  /** Mindcraft modules this target installs into an authoring environment, beyond core's own. */
  modules(): readonly MindcraftModule[];
  /** The documentation markdown this target ships for its own tiles, keyed by tile id. */
  tileDocs(): ReadonlyMap<string, string>;
  /** Population roles a scenario may name as its subject. */
  subjects(): readonly string[];
  /** Scenario input kinds this target reads; empty when it scripts no percepts. */
  inputKinds(): readonly string[];
  /**
   * Run one rehearsal. Throws if `scenario.subject` is not one of
   * {@link subjects}, an input names a kind outside {@link inputKinds}, or the
   * brain does not build.
   */
  run(request: SimulationRequest): Promise<SimulationRun>;
}

/**
 * The adapter surface an artifact must carry: every member name a host calls on
 * a {@link TargetAdapter}.
 */
export const adapterMethods = ["manifest", "modules", "tileDocs", "subjects", "inputKinds", "run"] as const;

/** Why an artifact could not stand in as a target adapter. */
export const AdapterNonconformanceCode = {
  /** The artifact module exports no `createTargetAdapter` function. */
  MissingFactory: "adapter_missing_factory",
  /** The artifact produced something other than an object. */
  NotAnObject: "adapter_not_an_object",
  /** The object is missing one or more of {@link adapterMethods}. */
  MissingMembers: "adapter_missing_members",
  /** The artifact was built against a different {@link ADAPTER_CONTRACT_VERSION}. */
  ContractVersionMismatch: "adapter_contract_version_mismatch",
  /** The artifact reports a package name other than the one the loader expected. */
  PackageMismatch: "adapter_package_mismatch",
} as const;

/** Why an artifact could not stand in as a target adapter. */
export type AdapterNonconformanceCode = (typeof AdapterNonconformanceCode)[keyof typeof AdapterNonconformanceCode];

/** One reason an artifact does not conform, machine-readable first. */
export interface AdapterNonconformance {
  readonly code: AdapterNonconformanceCode;
  /** Human-readable context; the code is the contract. */
  readonly detail: string;
}

/** What an artifact is checked against beyond the interface itself. */
export interface AdapterExpectation {
  /** Package name the artifact must report, from whatever names the artifact. */
  readonly packageName: string;
}

/**
 * Check `candidate` against the adapter interface, the contract version this
 * package defines, and `expectation`. Returns the first reason it does not
 * conform, or `undefined` when it does.
 */
export function adapterNonconformance(
  expectation: AdapterExpectation,
  candidate: unknown
): AdapterNonconformance | undefined {
  if (typeof candidate !== "object" || candidate === null) {
    return { code: AdapterNonconformanceCode.NotAnObject, detail: `adapter is ${typeof candidate}` };
  }
  const adapter = candidate as Partial<TargetAdapter>;

  const missing = adapterMethods.filter((name) => typeof adapter[name] !== "function");
  if (missing.length > 0) {
    return { code: AdapterNonconformanceCode.MissingMembers, detail: `missing ${missing.join(", ")}` };
  }
  if (adapter.contractVersion !== ADAPTER_CONTRACT_VERSION) {
    return {
      code: AdapterNonconformanceCode.ContractVersionMismatch,
      detail: `adapter was built for contract ${String(adapter.contractVersion)}; this loader holds ${ADAPTER_CONTRACT_VERSION}`,
    };
  }
  if (adapter.packageName !== expectation.packageName) {
    return {
      code: AdapterNonconformanceCode.PackageMismatch,
      detail: `adapter reports package ${JSON.stringify(adapter.packageName)}; ${JSON.stringify(expectation.packageName)} was expected`,
    };
  }
  return undefined;
}

/** The adapter an artifact publishes, or why it publishes none usable. */
export type AdapterArtifactResult =
  | { readonly ok: true; readonly adapter: TargetAdapter }
  | { readonly ok: false; readonly nonconformance: AdapterNonconformance };

/**
 * Read the adapter out of an imported artifact module: call the
 * `createTargetAdapter` it exports and check what it returns against
 * `expectation`. Propagates whatever the factory throws.
 */
export function readAdapterArtifact(artifactModule: unknown, expectation: AdapterExpectation): AdapterArtifactResult {
  const factory = (artifactModule as { createTargetAdapter?: unknown } | undefined)?.createTargetAdapter;
  if (typeof factory !== "function") {
    return {
      ok: false,
      nonconformance: {
        code: AdapterNonconformanceCode.MissingFactory,
        detail: "the module exports no createTargetAdapter function",
      },
    };
  }
  const candidate = (factory as () => unknown)();
  const nonconformance = adapterNonconformance(expectation, candidate);
  return nonconformance ? { ok: false, nonconformance } : { ok: true, adapter: candidate as TargetAdapter };
}
