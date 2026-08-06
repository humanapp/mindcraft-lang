import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IBrainDef } from "@mindcraft-lang/core/app";
import { summarizeRun } from "../simulate/summarizer.js";
import type { AdapterExpectation, SimulationRun, SimulationScenario, TargetAdapter } from "../target/adapter.js";
import { AdapterNonconformanceCode, adapterMethods, adapterNonconformance } from "../target/adapter.js";

/** Which property of a rehearsal adapter a check covers. */
export const ConformanceCheckCode = {
  /** The same seed reproduces the same run, byte for byte. */
  Determinism: "determinism",
  /** The summarized run fits a tool result. */
  Boundedness: "boundedness",
  /** The run observed the WHEN gates of the brain under study. */
  GateEvents: "gate_events",
  /** The built artifact loads and publishes a conforming adapter in plain Node. */
  HeadlessPurity: "headless_purity",
} as const;

/** Which property of a rehearsal adapter a check covers. */
export type ConformanceCheckCode = (typeof ConformanceCheckCode)[keyof typeof ConformanceCheckCode];

/** One conformance check's outcome. */
export interface ConformanceCheck {
  readonly code: ConformanceCheckCode;
  readonly ok: boolean;
  /** Human-readable context; the code and `ok` are the contract. */
  readonly detail: string;
}

/** Every conformance check run, and whether all of them held. */
export interface ConformanceReport {
  readonly ok: boolean;
  readonly checks: readonly ConformanceCheck[];
}

/** Largest summarized run a rehearsal may produce, in JSON characters. */
const maxSummaryLength = 16384;

/** What the in-process conformance checks run against. */
export interface AdapterConformanceOptions {
  readonly adapter: TargetAdapter;
  /** A brain that compiles against the adapter's modules and carries at least one rule. */
  readonly brainDef: IBrainDef;
  readonly scenario: SimulationScenario;
  /** Fixed-step thinks each conformance run covers. */
  readonly thinks: number;
}

/** Gather the checks into a report. */
function report(checks: readonly ConformanceCheck[]): ConformanceReport {
  return { ok: checks.every((check) => check.ok), checks };
}

/** Compare two runs of the same seed. */
function determinism(first: SimulationRun, second: SimulationRun): ConformanceCheck {
  const ok = JSON.stringify(first) === JSON.stringify(second);
  return {
    code: ConformanceCheckCode.Determinism,
    ok,
    detail: ok ? `${first.thinks} thinks reproduced` : "the same seed produced two different runs",
  };
}

/** Measure the summarized run against the tool-result budget. */
function boundedness(run: SimulationRun): ConformanceCheck {
  const length = JSON.stringify(summarizeRun(run)).length;
  return {
    code: ConformanceCheckCode.Boundedness,
    ok: length <= maxSummaryLength,
    detail: `summary is ${length} of at most ${maxSummaryLength} characters`,
  };
}

/** Confirm the run observed the WHEN gates of the brain under study. */
function gateEvents(run: SimulationRun): ConformanceCheck {
  const gates = run.observations.reduce((total, think) => total + think.gates.length, 0);
  return {
    code: ConformanceCheckCode.GateEvents,
    ok: gates > 0,
    detail: `${gates} gate observations over ${run.thinks} thinks`,
  };
}

/**
 * Run the checks a target's adapter must pass to be rehearsable: the same seed
 * reproduces the same run, the summarized run fits a tool result, and the run
 * observes the brain's WHEN gates. Runs the adapter twice.
 */
export async function checkAdapterConformance(options: AdapterConformanceOptions): Promise<ConformanceReport> {
  const request = { brainDef: options.brainDef, scenario: options.scenario, thinks: options.thinks };
  const first = await options.adapter.run(request);
  const second = await options.adapter.run(request);
  return report([determinism(first, second), boundedness(first), gateEvents(first)]);
}

const run = promisify(execFile);

/** What a freshly loaded artifact reported about the adapter it publishes. */
interface LoadedArtifact {
  /** `true` when the module exports a `createTargetAdapter` function. */
  readonly hasFactory: boolean;
  /** `typeof` what the factory returned. */
  readonly produced: string;
  readonly contractVersion?: unknown;
  readonly packageName?: unknown;
  /** The names from {@link adapterMethods} the produced object carries as functions. */
  readonly methods: readonly string[];
}

/** The script the child process runs to load one artifact and report its adapter. */
function loadScript(artifactUrl: URL): string {
  return `
    const members = ${JSON.stringify(adapterMethods)};
    const artifact = await import(${JSON.stringify(artifactUrl.href)});
    const factory = artifact.createTargetAdapter;
    if (typeof factory !== "function") {
      process.stdout.write(JSON.stringify({ hasFactory: false, produced: "undefined", methods: [] }));
    } else {
      const adapter = factory();
      const object = typeof adapter === "object" && adapter !== null ? adapter : {};
      process.stdout.write(JSON.stringify({
        hasFactory: true,
        produced: typeof adapter,
        contractVersion: object.contractVersion,
        packageName: object.packageName,
        methods: members.filter((name) => typeof object[name] === "function"),
      }));
    }
  `;
}

/** The adapter shape `loaded` describes, as an object the conformance check can read. */
function standIn(loaded: LoadedArtifact): unknown {
  if (loaded.produced !== "object") return undefined;
  const object: Record<string, unknown> = {
    contractVersion: loaded.contractVersion,
    packageName: loaded.packageName,
  };
  for (const name of loaded.methods) object[name] = () => undefined;
  return object;
}

/**
 * Load `artifactUrl` in a fresh Node process with no DOM and no bundler, and
 * check the adapter it publishes against `expectation`. This is the headless
 * purity a target's own gate runs against its built artifact.
 */
export async function checkArtifactLoads(artifactUrl: URL, expectation: AdapterExpectation): Promise<ConformanceCheck> {
  let loaded: LoadedArtifact;
  try {
    const { stdout } = await run(process.execPath, ["--input-type=module", "--eval", loadScript(artifactUrl)]);
    loaded = JSON.parse(stdout) as LoadedArtifact;
  } catch (cause) {
    return {
      code: ConformanceCheckCode.HeadlessPurity,
      ok: false,
      detail: `${artifactUrl.href} did not load: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  if (!loaded.hasFactory) {
    return {
      code: ConformanceCheckCode.HeadlessPurity,
      ok: false,
      detail: `${AdapterNonconformanceCode.MissingFactory}: ${artifactUrl.href} exports no createTargetAdapter function`,
    };
  }

  const nonconformance = adapterNonconformance(expectation, standIn(loaded));
  return {
    code: ConformanceCheckCode.HeadlessPurity,
    ok: nonconformance === undefined,
    detail: nonconformance
      ? `${nonconformance.code}: ${nonconformance.detail}`
      : `${artifactUrl.href} loaded and published a conforming adapter`,
  };
}
