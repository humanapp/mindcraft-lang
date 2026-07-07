/**
 * TS-equivalence conformance corpus: every entry is a small user-code source
 * set compiled through the real `UserTileProject` harness and pinned to
 * exactly one state in the manifest (`testsupport/ts-equivalence-manifest.ts`):
 *
 * - WORKS: compiles clean and the observable outcome (runtime value or
 *   registered shape) matches regular TypeScript semantics.
 * - BLOCKED: fails with the exact diagnostic code the manifest records; for
 *   constructs TypeScript itself rejects, the failure surfaces TypeScript's
 *   own error.
 *
 * An entry that lands in neither state fails the suite, so silent divergence
 * is unrepresentable. Known divergences live in the manifest's QUARANTINED
 * list (shrink-only). Compiler changes that add or change construct support
 * ship their corpus classifications in the same change.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List, runtime } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/runtime";
import {
  type EnumValue,
  HandleTable,
  isEnumValue,
  isStructValue,
  mkBufferValueFromHex,
  mkNumberValue,
  mkTypeId,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { BLOCKED, QUARANTINED, WORKS } from "../testsupport/ts-equivalence-manifest.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { CompileDiagCode } from "./diag-codes.js";
import { type ProjectCompileResult, UserTileProject } from "./project.js";
import { MultiRootSession, type ProjectRoot } from "./project-set.js";
import { publicSymbolKey, qualifiedClassName } from "./symbol-keys.js";
import type { CompileDiagnostic, UserAuthoredProgram } from "./types.js";

/** Compile outcome handed to a WORKS entry's assertion. */
interface WorksOutcome {
  services: BrainServices;
  result: ProjectCompileResult;
  program: UserAuthoredProgram;
}

/** One conformance corpus entry: a source set plus its pinned observation. */
interface CorpusEntry {
  /** Unique name; the manifest classifies it. */
  name: string;
  /** Workspace source files compiled through the project harness. */
  files: Record<string, string>;
  /** Path of the tile entry file whose compiled program is observed. */
  entry: string;
  /**
   * Project roots compiled through a publication-enabled multi-root session.
   * When present, `files` is unused and the observed result is `observe`'s.
   * Namespaces must be unique across corpus entries (the registry session is
   * shared).
   */
  roots?: ProjectRoot[];
  /** Namespace whose compile result the entry observes; required with `roots`. */
  observe?: string;
  /**
   * Asserts the observable TypeScript-semantics outcome. Required for WORKS
   * and QUARANTINED entries.
   */
  expectWorks?: (outcome: WorksOutcome) => void;
  /**
   * For entries blocked by TypeScript itself: the pattern TypeScript's own
   * error message must match.
   */
  tsError?: RegExp;
}

let sharedServices: BrainServices | undefined;
let ambientContent: string | undefined;

function services(): BrainServices {
  if (!sharedServices) {
    sharedServices = __test__createBrainServices();
    ambientContent = buildAmbientDeclarations(sharedServices.runtime.types);
  }
  return sharedServices;
}

/** Compile an entry over the shared services: a fresh {@link UserTileProject}, or a {@link MultiRootSession} for root-set entries. */
function compileFiles(entry: Pick<CorpusEntry, "files" | "roots" | "observe">): {
  services: BrainServices;
  result: ProjectCompileResult;
} {
  const svc = services();
  if (entry.roots) {
    const session = new MultiRootSession({
      services: svc,
      ambientFiles: [{ path: "ambient.d.ts", content: ambientContent! }],
    });
    session.setRoots(entry.roots);
    const { roots } = session.compile();
    const result = roots.get(entry.observe!);
    assert.ok(result, `expected a compile result for root ${entry.observe}`);
    return { services: svc, result };
  }
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientContent! }],
    services: svc,
  });
  project.setFiles(new Map(Object.entries(entry.files)));
  return { services: svc, result: project.compileAll() };
}

/** Compile a WORKS entry, asserting a clean compile, and return its outcome. */
function compileWorks(entry: CorpusEntry): WorksOutcome {
  const { services: svc, result } = compileFiles(entry);
  assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
  const compiled = result.results.get(entry.entry);
  assert.ok(compiled, `expected a compile result for ${entry.entry}`);
  const errors = compiled.diagnostics.filter((d) => d.severity === "error");
  assert.deepEqual(errors, [], `error diagnostics for ${entry.entry}: ${JSON.stringify(errors)}`);
  assert.ok(compiled.program, `expected a compiled program for ${entry.entry}`);
  return { services: svc, result, program: compiled.program };
}

function toVmServices(b: BrainServices) {
  return __test__createPlatformServices({ runtime: { functions: b.runtime.functions, types: b.runtime.types } })
    .runtime;
}

function mkCtx(b: BrainServices): ExecutionContext {
  return {
    services: __test__createPlatformServices({
      runtime: { functions: b.runtime.functions, types: b.runtime.types },
    }),
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

/**
 * Build a runner for the entry program's onExecute. Module state slots and
 * handles persist across calls, and the module initializer and activation
 * hooks run once up front, matching one call site in a running brain.
 */
function makeRunner(outcome: WorksOutcome): (args?: Value[]) => Value | undefined {
  const prog = outcome.program;
  const vmServices = toVmServices(outcome.services);
  const handles = new HandleTable(100);
  const callsiteVars = List.from<Value>(Array.from({ length: prog.numStateSlots }, () => NIL_VALUE));
  const runFn = (funcId: number, args: List<Value>): Value | undefined => {
    const vm = new runtime.VM(prog, vmServices, { handles });
    const fiber = vm.spawnFiber(1, funcId, args, mkCtx(outcome.services));
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 10000;
    const r = vm.runFiber(fiber, mkScheduler());
    assert.equal(r.status, VmStatus.DONE, `fiber did not finish (func ${funcId})`);
    return r.status === VmStatus.DONE ? r.result : undefined;
  };
  if (prog.initializerFuncId !== undefined) {
    runFn(prog.initializerFuncId, List.empty());
  }
  if (prog.activationFuncId !== undefined) {
    runFn(prog.activationFuncId, List.empty());
  }
  return (args?: Value[]) => runFn(prog.entryFuncId, args ? List.from(args) : List.empty<Value>());
}

function expectNumber(value: Value | undefined, expected: number): void {
  assert.ok(value, "expected a value");
  assert.equal(value.t, NativeType.Number, `expected a number, got ${JSON.stringify(value)}`);
  assert.equal((value as NumberValue).v, expected);
}

/** Run the entry program once and assert it returns `expected`. */
function runsToNumber(expected: number, args?: Value[]): (outcome: WorksOutcome) => void {
  return (outcome) => {
    expectNumber(makeRunner(outcome)(args), expected);
  };
}

function nums(...values: number[]): Value[] {
  return values.map((n) => mkNumberValue(n));
}

const SENSOR_IMPORT = `import { Sensor, type Context } from "mindcraft";\n`;

/** A no-arg number sensor whose onExecute body is `body`; `above` precedes the declaration. */
function numberSensor(body: string, above = ""): string {
  return `${SENSOR_IMPORT}
${above}
export default Sensor({
  name: "conformance probe", inline: true,
  onExecute(ctx: Context): number {
    ${body}
  },
});
`;
}

/** A sensor with two number args `a` and `b`, whose onExecute body is `body`. */
function twoArgSensor(body: string): string {
  return `import { Sensor, type Context, param } from "mindcraft";

export default Sensor({
  name: "conformance probe",
  args: [param("a", { type: "number" }), param("b", { type: "number" })],
  onExecute(ctx: Context, args: { a: number; b: number }): number {
    ${body}
  },
});
`;
}

const MODE_ENUM = `export enum Mode {
  Stop = 0,
  Go = 2,
}
`;

const CORPUS_POSITION_SOURCE = `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: NumberType },
});
export type Position = StructOf<typeof Position>;
`;

const CORPUS_STICK_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "stick position", inline: true,
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 3, y: 4 });
  },
});
`;

/**
 * Expects the sensor's output type to be the enum declared as `name` in
 * `file`, and one run to produce the enum value `member`.
 */
function expectsEnumOutput(file: string, name: string, member: string): (outcome: WorksOutcome) => void {
  return (o) => {
    const typeId = mkTypeId(NativeType.Enum, qualifiedClassName(TEST_PROJECT_NAMESPACE, file, name));
    assert.equal(o.program.outputType, typeId, "the sensor's output type is the qualified enum");
    const value = makeRunner(o)();
    assert.ok(value && isEnumValue(value), `expected an enum value, got ${JSON.stringify(value)}`);
    assert.equal((value as EnumValue).v, member);
  };
}

/**
 * Expects the sensor's output type to be the struct registered for the named
 * type declared as `name` in `file`, and one run to produce a struct value.
 */
function expectsStructOutput(file: string, name: string): (outcome: WorksOutcome) => void {
  return (o) => {
    const typeId = mkTypeId(NativeType.Struct, qualifiedClassName(TEST_PROJECT_NAMESPACE, file, name));
    assert.equal(o.program.outputType, typeId, "the sensor's output type is the qualified struct");
    const value = makeRunner(o)();
    assert.ok(value && isStructValue(value), `expected a struct value, got ${JSON.stringify(value)}`);
    assert.equal(value.typeId, typeId, "the returned value carries the qualified struct type");
  };
}

const INNER_CLASS = `export class Inner {
  x: number;
  constructor() {
    this.x = 3;
  }
  double(): number {
    return this.x * 2;
  }
}
`;

const OUTER_CLASS = `export class Outer {
  inner: Inner;
  tag: number;
  constructor() {
    this.inner = new Inner();
    this.tag = 7;
  }
}
`;

const OUTER_ENTRY = `${SENSOR_IMPORT}import { Outer } from "./defs";

export default Sensor({
  name: "outer probe", inline: true,
  onExecute(ctx: Context): number {
    const o = new Outer();
    return o.inner.x + o.tag;
  },
});
`;

const POSITION_STRUCT = `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
});
export type Position = StructOf<typeof Position>;
`;

const WARM_REGISTRY_FILES: Record<string, string> = {
  "position.ts": POSITION_STRUCT,
  "entry.ts": `${SENSOR_IMPORT}import { Position } from "./position";

export default Sensor({
  name: "stick position", inline: true,
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 3, y: 4 });
  },
});
`,
};

const CORPUS: readonly CorpusEntry[] = [
  // -- declaration order and module layout --------------------------------
  {
    name: "class-field-type-declared-above",
    files: { "defs.ts": `${INNER_CLASS}\n${OUTER_CLASS}`, "entry.ts": OUTER_ENTRY },
    entry: "entry.ts",
    expectWorks: (o) => {
      const qualified = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Inner");
      assert.ok(o.services.runtime.types.resolveByName(qualified), "the class registers under its qualified name");
      assert.equal(o.services.runtime.types.resolveByName("Inner"), undefined, "no bare-name shadow registers");
      expectNumber(makeRunner(o)(), 10);
    },
  },
  {
    name: "class-field-type-declared-below",
    files: { "defs.ts": `${OUTER_CLASS}\n${INNER_CLASS}`, "entry.ts": OUTER_ENTRY },
    entry: "entry.ts",
    expectWorks: runsToNumber(10),
  },
  {
    name: "entry-class-composes-imported-class",
    files: {
      "defs.ts": INNER_CLASS,
      "entry.ts": `${SENSOR_IMPORT}import { Inner } from "./defs";

class Outer {
  inner: Inner;
  tag: number;
  constructor() {
    this.inner = new Inner();
    this.tag = 7;
  }
}

export default Sensor({
  name: "outer probe", inline: true,
  onExecute(ctx: Context): number {
    const o = new Outer();
    return o.inner.x + o.tag;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(10),
  },
  {
    name: "class-field-typed-by-alias-below",
    files: {
      "entry.ts": numberSensor(
        "const h = new Holder();\n    return h.cfg.v;",
        `class Holder {
  cfg: Speed;
  constructor() {
    this.cfg = { v: 3 };
  }
}

type Speed = { v: number };
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(3),
  },
  {
    name: "class-field-typed-by-same-module-interface",
    files: {
      "entry.ts": numberSensor(
        "const r = new Rover();\n    return r.cfg.speed;",
        `interface Settings {
  speed: number;
}

class Rover {
  cfg: Settings;
  constructor() {
    this.cfg = { speed: 2 };
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(2),
  },
  {
    name: "nullable-self-reference-class-field",
    files: {
      "entry.ts": numberSensor(
        `const a = new Node();
    const b = new Node();
    b.x = 5;
    a.next = b;
    if (a.next === undefined) {
      return -1;
    }
    return a.next.x;`,
        `class Node {
  x: number;
  next?: Node;
  constructor() {
    this.x = 1;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(5),
  },
  {
    name: "class-instance-method-call",
    files: {
      "entry.ts": numberSensor(
        "return new Doubler(21).twice();",
        `class Doubler {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  twice(): number {
    return this.n * 2;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(42),
  },
  {
    name: "local-enum-member-value",
    files: {
      "entry.ts": `${SENSOR_IMPORT}
enum Mode {
  Stop = 0,
  Go = 2,
}

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): Mode {
    return Mode.Go;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const typeId = mkTypeId(NativeType.Enum, qualifiedClassName(TEST_PROJECT_NAMESPACE, "/entry.ts", "Mode"));
      assert.equal(o.program.outputType, typeId, "the sensor's output type is the qualified enum");
      const value = makeRunner(o)();
      assert.ok(value && isEnumValue(value), `expected an enum value, got ${JSON.stringify(value)}`);
      assert.equal((value as EnumValue).v, "Go");
    },
  },
  {
    name: "imported-enum-member-value",
    files: {
      "defs.ts": `export enum Mode {
  Stop = 0,
  Go = 2,
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): Mode {
    return Mode.Go;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const typeId = mkTypeId(NativeType.Enum, qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Mode"));
      assert.equal(o.program.outputType, typeId, "the sensor's output type is the qualified enum");
      const value = makeRunner(o)();
      assert.ok(value && isEnumValue(value), `expected an enum value, got ${JSON.stringify(value)}`);
      assert.equal((value as EnumValue).v, "Go");
    },
  },
  {
    name: "imported-enum-member-in-expression",
    files: {
      "defs.ts": `export enum Mode {
  Stop = 0,
  Go = 2,
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): number {
    const m = Mode.Go;
    return m === Mode.Go ? 1 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(1),
  },
  {
    name: "enum-inequality-via-params",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

function differs(a: Mode, b: Mode): boolean {
  return a !== b;
}

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): number {
    return differs(Mode.Go, Mode.Stop) ? 1 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(1),
  },
  {
    name: "enum-ternary-of-enum-literals",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

function pick(fast: boolean): Mode {
  return fast ? Mode.Go : Mode.Stop;
}

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): Mode {
    return pick(true);
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: expectsEnumOutput("/defs.ts", "Mode", "Go"),
  },
  {
    name: "enum-alias-members-compare-equal",
    files: {
      "entry.ts": `${SENSOR_IMPORT}
enum Mode {
  Primary = 1,
  Alias = 1,
}

function same(a: Mode, b: Mode): boolean {
  return a === b;
}

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): number {
    return same(Mode.Primary, Mode.Alias) ? 1 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(1),
  },
  {
    name: "enum-member-arithmetic-with-number",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): number {
    return Mode.Go + 1;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(3),
  },
  {
    name: "template-literal-embeds-enum-value",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): number {
    const text = \`mode=\${Mode.Go}\`;
    return text === "mode=2" ? 1 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(1),
  },
  {
    name: "enum-into-number-variable-store",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): number {
    let n: number = Mode.Stop;
    n = Mode.Go;
    return n + 1;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(3),
  },
  {
    name: "string-global-converts-enum",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): string {
    return String(Mode.Go);
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "enum-relational-compare",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

function below(a: Mode, b: Mode): boolean {
  return a < b;
}

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): boolean {
    return below(Mode.Stop, Mode.Go);
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "enum-declared-below-referencing-class",
    files: {
      "defs.ts": `export class Flag {
  c: Color;
  constructor() {
    this.c = Color.Green;
  }
}

export enum Color {
  Red = "r",
  Green = "g",
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { Color, Flag } from "./defs";

export default Sensor({
  name: "flag probe", inline: true,
  onExecute(ctx: Context): number {
    return new Flag().c === Color.Green ? 1 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(1),
  },
  {
    name: "enum-declared-below-sensor-return",
    files: {
      "entry.ts": `${SENSOR_IMPORT}
export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): Mode {
    return Mode.Go;
  },
});

enum Mode {
  Stop = 0,
  Go = 2,
}
`,
    },
    entry: "entry.ts",
    expectWorks: expectsEnumOutput("/entry.ts", "Mode", "Go"),
  },
  {
    name: "sensor-returns-renamed-imported-enum",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode as M } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): M {
    return M.Go;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: expectsEnumOutput("/defs.ts", "Mode", "Go"),
  },
  {
    name: "sensor-return-type-by-local-enum-ref",
    files: {
      "entry.ts": `${SENSOR_IMPORT}
enum Mode {
  Stop = 0,
  Go = 2,
}

export default Sensor({
  name: "mode probe", inline: true,
  returnType: Mode,
  onExecute(ctx: Context): Mode {
    return Mode.Go;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: expectsEnumOutput("/entry.ts", "Mode", "Go"),
  },
  {
    name: "sensor-return-type-by-imported-enum-ref",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  returnType: Mode,
  onExecute(ctx: Context): Mode {
    return Mode.Go;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: expectsEnumOutput("/defs.ts", "Mode", "Go"),
  },
  {
    name: "sensor-param-typed-by-imported-enum-ref",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `import { Sensor, type Context, param } from "mindcraft";
import { Mode } from "./defs";

export default Sensor({
  name: "mode probe",
  args: [param("m", { type: Mode })],
  onExecute(ctx: Context, args: { m: Mode }): number {
    return args.m === Mode.Go ? 1 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const qualified = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Mode");
      const paramSpec = o.program.args?.[0];
      assert.ok(paramSpec && paramSpec.kind === "param", "expected one param arg spec");
      assert.equal(paramSpec.type, qualified, "the param carries the enum's qualified name");
      const typeId = o.services.runtime.types.resolveByName(qualified);
      assert.ok(typeId, "the imported enum registers under its qualified name");
      expectNumber(makeRunner(o)([{ t: NativeType.Enum, typeId, v: "Go" }]), 1);
    },
  },
  {
    name: "sensor-output-typed-by-imported-enum-ref",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `import { Sensor, setOutput, type Context } from "mindcraft";
import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  outputs: [{ name: "mode", type: Mode }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "mode", Mode.Go);
    return 1;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const qualified = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Mode");
      assert.equal(o.program.outputs?.[0]?.type, qualified, "the output carries the enum's qualified name");
      expectNumber(makeRunner(o)(), 1);
    },
  },
  {
    name: "consumes-when-result-imported-enum-ref",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "when consumer", inline: true,
  consumesWhenResult: Mode,
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const typeId = o.services.runtime.types.resolveByName(
        qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Mode")
      );
      assert.ok(typeId, "the imported enum registers under its qualified name");
      assert.equal(o.program.consumesWhenResult, typeId, "consumesWhenResult resolves to the imported enum");
      expectNumber(makeRunner(o)(), 1);
    },
  },
  {
    name: "sensor-returns-imported-class",
    files: {
      "defs.ts": `export class Flag {
  n: number;
  constructor() {
    this.n = 7;
  }
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { Flag } from "./defs";

export default Sensor({
  name: "flag probe", inline: true,
  onExecute(ctx: Context): Flag {
    return new Flag();
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: expectsStructOutput("/defs.ts", "Flag"),
  },
  {
    name: "sensor-returns-imported-interface",
    files: {
      "defs.ts": `export interface Shape {
  n: number;
}
`,
      "entry.ts": `${SENSOR_IMPORT}import type { Shape } from "./defs";

export default Sensor({
  name: "shape probe", inline: true,
  onExecute(ctx: Context): Shape {
    return { n: 4 };
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: expectsStructOutput("/defs.ts", "Shape"),
  },
  {
    name: "sensor-returns-imported-alias",
    files: {
      "defs.ts": `export type Pair = { a: number; b: number };
`,
      "entry.ts": `${SENSOR_IMPORT}import type { Pair } from "./defs";

export default Sensor({
  name: "pair probe", inline: true,
  onExecute(ctx: Context): Pair {
    return { a: 1, b: 2 };
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: expectsStructOutput("/defs.ts", "Pair"),
  },
  {
    name: "system-state-typed-by-imported-enum",
    files: {
      "defs.ts": MODE_ENUM,
      "sys.ts": `import { System } from "mindcraft";
import { Mode } from "./defs";

export const Motion = System({
  name: "motion",
  state: { mode: Mode.Go },
});
`,
      "entry.ts": `${SENSOR_IMPORT}import { Motion } from "./sys";
import { Mode } from "./defs";

export default Sensor({
  name: "sys probe", inline: true,
  onExecute(ctx: Context): number {
    return Motion.mode === Mode.Go ? 1 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const enumId = o.services.runtime.types.resolveByName(
        qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Mode")
      );
      assert.ok(enumId, "the imported enum registers under its qualified name");
      assert.ok(
        o.services.runtime.types.resolveByName(`{mode:${enumId}}`),
        "the System state field carries the qualified enum type"
      );
    },
  },
  {
    name: "actuator-param-imported-enum-by-name",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `import { Actuator, type Context, param } from "mindcraft";
import { Mode } from "./defs";

export default Actuator({
  name: "mode act",
  args: [param("m", { type: "Mode" })],
  onExecute(ctx: Context, args: { m: Mode }): void {
    if (args.m === Mode.Go) {
      return;
    }
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "sensor-returns-nullable-enum",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): Mode | null {
    return Mode.Go;
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "sensor-returns-undefined-union-enum",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `${SENSOR_IMPORT}import { Mode } from "./defs";

export default Sensor({
  name: "mode probe", inline: true,
  onExecute(ctx: Context): Mode | undefined {
    return Mode.Go;
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "sensor-returns-imported-struct-instance-alias",
    files: {
      "point.ts": `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Point = StructType({
  name: "point",
  fields: { x: NumberType, y: NumberType },
});
export type PointValue = StructOf<typeof Point>;
`,
      "entry.ts": `${SENSOR_IMPORT}import { Point, type PointValue } from "./point";

export default Sensor({
  name: "point probe", inline: true,
  onExecute(ctx: Context): PointValue {
    return Point({ x: 1, y: 2 });
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "conversion-from-enum-ref",
    files: {
      "defs.ts": MODE_ENUM,
      "entry.ts": `import { Conversion, NumberType } from "mindcraft";
import { Mode } from "./defs";

export default Conversion({
  from: Mode,
  to: NumberType,
  cost: 1,
  convert(value: Mode): number {
    return value === Mode.Go ? 2 : 0;
  },
});
`,
    },
    entry: "entry.ts",
    tsError: /'typeof Mode' is not assignable/,
  },
  {
    name: "struct-field-typed-by-enum-binding",
    files: {
      "entry.ts": `${SENSOR_IMPORT}import { NumberType, StructType } from "mindcraft";

enum Mode {
  Stop = 0,
  Go = 2,
}

const Reading = StructType({ name: "reading", fields: { m: Mode, n: NumberType } });

export default Sensor({
  name: "probe", inline: true,
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
    },
    entry: "entry.ts",
    tsError: /'typeof Mode' is not assignable/,
  },
  {
    name: "struct-type-factory-and-field-read",
    files: {
      "entry.ts": `import { NumberType, Sensor, StructType, type StructOf, type Context } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
});
export type Position = StructOf<typeof Position>;

export default Sensor({
  name: "pos sum", inline: true,
  onExecute(ctx: Context): number {
    const p = Position({ x: 30, y: 12 });
    return p.x + p.y;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const identity = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/entry.ts", "Position");
      assert.ok(o.services.runtime.types.resolveByName(identity), "the struct registers under its symbol identity");
      expectNumber(makeRunner(o)(), 42);
    },
  },
  {
    name: "nested-struct-across-modules",
    files: {
      "position.ts": POSITION_STRUCT,
      "sprite.ts": `import { StructType, type StructOf } from "mindcraft";
import { Position } from "./position";

export const Sprite = StructType({
  name: "sprite",
  fields: { pos: Position, tag: "number" },
});
export type Sprite = StructOf<typeof Sprite>;
`,
      "entry.ts": `${SENSOR_IMPORT}import { Position } from "./position";
import { Sprite } from "./sprite";

export default Sensor({
  name: "sprite probe", inline: true,
  onExecute(ctx: Context): number {
    const s = Sprite({ pos: Position({ x: 4, y: 5 }), tag: 6 });
    return s.pos.x * 100 + s.pos.y * 10 + s.tag;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(456),
  },
  {
    name: "module-private-same-name-structs-coexist",
    files: {
      "a.ts": `import { NumberType, StructType, type StructOf } from "mindcraft";

const Vec = StructType({
  name: "vec-a",
  fields: { x: NumberType },
});
type Vec = StructOf<typeof Vec>;

export function makeA(): number {
  const v = Vec({ x: 7 });
  return v.x;
}
`,
      "b.ts": `import { NumberType, StructType, type StructOf } from "mindcraft";

const Vec = StructType({
  name: "vec-b",
  fields: { x: NumberType },
});
type Vec = StructOf<typeof Vec>;

export function makeB(): number {
  const v = Vec({ x: 8 });
  return v.x;
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { makeA } from "./a";
import { makeB } from "./b";

export default Sensor({
  name: "vec probe", inline: true,
  onExecute(ctx: Context): number {
    return makeA() * 10 + makeB();
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const typeA = o.services.runtime.types.resolveByName(qualifiedClassName(TEST_PROJECT_NAMESPACE, "/a.ts", "Vec"));
      const typeB = o.services.runtime.types.resolveByName(qualifiedClassName(TEST_PROJECT_NAMESPACE, "/b.ts", "Vec"));
      assert.ok(typeA && typeB, "both module-private declarations register");
      assert.notEqual(typeA, typeB, "the two same-name declarations are distinct types");
      expectNumber(makeRunner(o)(), 78);
    },
  },
  {
    name: "module-let-state-is-per-callsite",
    files: {
      "entry.ts": `${SENSOR_IMPORT}
let count = 0;

export default Sensor({
  name: "counter", inline: true,
  onExecute(ctx: Context): number {
    count = count + 1;
    return count;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const first = makeRunner(o);
      expectNumber(first(), 1);
      expectNumber(first(), 2);
      const second = makeRunner(o);
      expectNumber(second(), 1);
    },
  },
  // -- names and narrowing ------------------------------------------------
  {
    name: "arg-shadowing-local-resolves-to-local",
    files: { "entry.ts": twoArgSensor("const a = 7;\n    return args.a * 100 + args.b * 10 + a;") },
    entry: "entry.ts",
    expectWorks: runsToNumber(357, nums(3, 5)),
  },
  {
    name: "shadowing-local-captured-by-nested-function",
    files: {
      "entry.ts": twoArgSensor(
        "const a = 7;\n    function readA(): number { return a; }\n    return args.a * 100 + args.b * 10 + readA();"
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(357, nums(3, 5)),
  },
  {
    name: "optional-buffer-arg-presence-guard",
    files: {
      "entry.ts": `import { Sensor, type Context, optional, param } from "mindcraft";

export default Sensor({
  name: "presence probe",
  args: [optional(param("packet", { type: "buffer", anonymous: true }))],
  onExecute(ctx: Context, args: { packet?: Buffer }): number {
    const b = args.packet;
    if (b) {
      return b.length();
    }
    return -1;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      expectNumber(makeRunner(o)([NIL_VALUE]), -1);
      expectNumber(makeRunner(o)([mkBufferValueFromHex("2a0709")]), 3);
    },
  },
  {
    name: "buffer-isbuffer-type-guard",
    files: {
      "entry.ts": numberSensor(
        `let t = 0;
    if (Buffer.isBuffer(Buffer.from([1, 2]))) {
      t = t + 10;
    }
    if (Buffer.isBuffer(5)) {
      t = t + 1;
    }
    return t;`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(10),
  },
  {
    name: "typeof-narrows-union",
    files: {
      "entry.ts": numberSensor(
        `const v = pick(true);
    if (typeof v === "number") {
      return v * 2;
    }
    return -1;`,
        `function pick(useNumber: boolean): number | string {
  if (useNumber) {
    return 21;
  }
  return "word";
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(42),
  },
  {
    name: "instanceof-narrows-class-union",
    files: {
      "entry.ts": numberSensor(
        `const a = pick(true);
    if (a instanceof Cat) {
      return a.legs;
    }
    return -1;`,
        `function pick(cat: boolean): Cat | Bird {
  if (cat) {
    return new Cat();
  }
  return new Bird();
}

class Cat {
  legs: number;
  constructor() {
    this.legs = 4;
  }
}

class Bird {
  wings: number;
  constructor() {
    this.wings = 2;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(4),
  },
  {
    name: "optional-chaining-nullable-field",
    files: {
      "entry.ts": numberSensor(
        `const a = new Node(1);
    const b = new Node(5);
    a.next = b;
    const got = a.next?.x;
    if (got === undefined) {
      return -1;
    }
    return got;`,
        `class Node {
  x: number;
  next?: Node;
  constructor(x: number) {
    this.x = x;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(5),
  },
  // -- generics at concrete usage sites ------------------------------------
  {
    name: "generic-interface-concrete-instantiation",
    files: {
      "entry.ts": numberSensor(
        "const b: Box<number> = { value: 21 };\n    return b.value * 2;",
        `interface Box<T> {
  value: T;
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(42),
  },
  {
    name: "generic-class-concrete-instantiation",
    files: {
      "entry.ts": numberSensor(
        "return new Holder<number>(21).get() * 2;",
        `class Holder<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  get(): T {
    return this.v;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(42),
  },
  {
    name: "generic-alias-concrete-instantiation",
    files: {
      "entry.ts": numberSensor(
        "const p: Pair<number, number> = { a: 4, b: 5 };\n    return p.a * 10 + p.b;",
        `type Pair<A, B> = { a: A; b: B };
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(45),
  },
  {
    name: "partial-utility-type-concrete-use",
    files: {
      "entry.ts": numberSensor(
        `const c: Partial<Cfg> = { speed: 3 };
    if (c.speed === undefined) {
      return -1;
    }
    return c.speed;`,
        `interface Cfg {
  speed: number;
  turbo: boolean;
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(3),
  },
  // -- destructuring --------------------------------------------------------
  {
    name: "array-rest-destructuring",
    files: {
      "entry.ts": numberSensor(
        `const arr: number[] = [7, 8, 9];
    const [first, ...rest] = arr;
    return first * 100 + rest[0] * 10 + rest[1];`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(789),
  },
  {
    name: "object-rest-destructuring",
    files: {
      "entry.ts": numberSensor(
        `const obj: P3 = { x: 1, y: 2, z: 3 };
    const { x, ...rest } = obj;
    return x * 100 + rest.y * 10 + rest.z;`,
        `interface P3 {
  x: number;
  y: number;
  z: number;
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(123),
  },
  {
    name: "nested-destructuring",
    files: {
      "entry.ts": numberSensor(
        `const e: Ent = { pos: { x: 4, y: 5 }, tag: 6 };
    const { pos: { x, y }, tag } = e;
    return x * 100 + y * 10 + tag;`,
        `interface Pos {
  x: number;
  y: number;
}

interface Ent {
  pos: Pos;
  tag: number;
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(456),
  },
  // -- declarations beyond tiles --------------------------------------------
  {
    name: "conversion-declaration-resolves-pair",
    files: {
      "entry.ts": `import { BufferType, Conversion, NumberType } from "mindcraft";

export default Conversion({
  from: NumberType,
  to: BufferType,
  cost: 2,
  convert(value: number): Buffer {
    return Buffer.from([7, value, value + 1]);
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      assert.equal(o.program.kind, "conversion");
      assert.ok(o.program.conversion, "expected conversion pair metadata");
      assert.equal(o.program.conversion.fromType, o.services.runtime.types.resolveByName("number"));
      assert.equal(o.program.conversion.toType, o.services.runtime.types.resolveByName("buffer"));
    },
  },
  {
    name: "recompile-against-warm-registry",
    files: WARM_REGISTRY_FILES,
    entry: "entry.ts",
    expectWorks: (o) => {
      const firstTypeId = o.program.structTypes?.[0]?.typeId;
      assert.ok(firstTypeId, "expected the struct on the first compile");
      const again = compileFiles({ files: WARM_REGISTRY_FILES });
      assert.equal(again.result.tsErrors.size, 0);
      const reProgram = again.result.results.get("entry.ts")?.program;
      assert.ok(reProgram, "the warm-registry compile produces a program");
      assert.equal(reProgram.structTypes?.[0]?.typeId, firstTypeId, "the warm compile resolves the same type id");
    },
  },
  {
    name: "system-state-typed-by-imported-class",
    files: {
      "defs.ts": `export class Pt {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
`,
      "entry.ts": `import { Sensor, System, type Context } from "mindcraft";
import { Pt } from "./defs";

const Track = System({
  name: "track",
  state: { pt: new Pt(3) },
  think(ctx: Context) {
    this.pt = new Pt(this.pt.x + 1);
  },
});

export default Sensor({
  name: "track read", inline: true,
  onExecute(ctx: Context): number {
    return Track.pt.x;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: (o) => {
      const classId = o.services.runtime.types.resolveByName(
        qualifiedClassName(TEST_PROJECT_NAMESPACE, "/defs.ts", "Pt")
      );
      assert.ok(classId, "the imported class registers under its qualified name");
      assert.ok(
        o.services.runtime.types.resolveByName(`{pt:${classId}}`),
        "the System state field carries the qualified class type"
      );
    },
  },
  {
    name: "helper-function-declared-below-class",
    files: {
      "entry.ts": numberSensor(
        "return pick(true).legs;",
        `class Cat {
  legs: number;
  constructor() {
    this.legs = 4;
  }
}

function pick(cat: boolean): Cat {
  return new Cat();
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(4),
  },
  {
    name: "helper-function-declared-between-classes",
    files: {
      "entry.ts": numberSensor(
        "return pick(new Cat(), new Dog());",
        `class Cat {
  legs: number;
  constructor() {
    this.legs = 4;
  }
}

function pick(cat: Cat, dog: Dog): number {
  return cat.legs * 10 + dog.tails;
}

class Dog {
  tails: number;
  constructor() {
    this.tails = 1;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(41),
  },
  {
    name: "class-method-calls-helper-declared-below",
    files: {
      "entry.ts": numberSensor(
        "return new Counter().bump();",
        `class Counter {
  n: number;
  constructor() {
    this.n = 40;
  }
  bump(): number {
    return this.n + two();
  }
}

function two(): number {
  return 2;
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(42),
  },
  {
    name: "helpers-and-classes-interleaved",
    files: {
      "entry.ts": numberSensor(
        "return first() * 100 + new Mid().v * 10 + last();",
        `function first(): number {
  return 1;
}

class Mid {
  v: number;
  constructor() {
    this.v = 2;
  }
}

function second(): number {
  return 3;
}

class End {
  w: number;
  constructor() {
    this.w = 4;
  }
}

function last(): number {
  return second() + new End().w;
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(127),
  },
  {
    name: "helper-declared-below-enum-struct-and-system",
    files: {
      "entry.ts": `import { NumberType, Sensor, StructType, System, type Context, type StructOf } from "mindcraft";

enum Gear {
  Low = 1,
  High = 3,
}

export const Pace = StructType({
  name: "pace",
  fields: { v: NumberType },
});
export type Pace = StructOf<typeof Pace>;

const Tally = System({
  name: "tally",
  state: { total: 30 },
});

function readAll(): number {
  return Pace({ v: 8 }).v + Gear.High;
}

export default Sensor({
  name: "conformance probe", inline: true,
  onExecute(ctx: Context): number {
    return readAll();
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(11),
  },
  {
    name: "imported-helper-below-imported-class",
    files: {
      "defs.ts": `export class Box {
  v: number;
  constructor() {
    this.v = 21;
  }
}

export function makeBox(): Box {
  return new Box();
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { makeBox } from "./defs";

export default Sensor({
  name: "box probe", inline: true,
  onExecute(ctx: Context): number {
    return makeBox().v * 2;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(42),
  },
  {
    name: "imported-helper-with-local-class",
    files: {
      "defs.ts": `export function boost(n: number): number {
  return n * 2;
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { boost } from "./defs";

class Local {
  v: number;
  constructor() {
    this.v = 21;
  }
}

export default Sensor({
  name: "boost probe", inline: true,
  onExecute(ctx: Context): number {
    return boost(new Local().v);
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(42),
  },
  {
    name: "setter-declared-before-unrelated-getter",
    files: {
      "entry.ts": numberSensor(
        `const g = new Gauge();
    g.scaled = 10;
    return g.half + g.raw;`,
        `class Gauge {
  raw: number;
  constructor() {
    this.raw = 0;
  }
  set scaled(v: number) {
    this.raw = v * 2;
  }
  get half(): number {
    return this.raw / 2;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(30),
  },
  {
    name: "separate-statement-export-class",
    files: {
      "defs.ts": `class Greeter {
  n: number;
  constructor() {
    this.n = 9;
  }
}

export { Greeter };
`,
      "entry.ts": `${SENSOR_IMPORT}import { Greeter } from "./defs";

export default Sensor({
  name: "greeter probe", inline: true,
  onExecute(ctx: Context): number {
    return new Greeter().n;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(9),
  },
  {
    name: "re-export-from-barrel",
    files: {
      "impl.ts": `class Greeter {
  n: number;
  constructor() {
    this.n = 9;
  }
}

export { Greeter };
`,
      "barrel.ts": `export { Greeter } from "./impl";
`,
      "entry.ts": `${SENSOR_IMPORT}import { Greeter } from "./barrel";

export default Sensor({
  name: "barrel probe", inline: true,
  onExecute(ctx: Context): number {
    return new Greeter().n;
  },
});
`,
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(9),
  },
  {
    name: "entry-publishes-re-exported-type",
    files: {},
    roots: [
      {
        namespace: "corpus-pub-works",
        files: new Map([
          ["position.ts", CORPUS_POSITION_SOURCE],
          ["index.ts", `export { Position } from "./position";\n`],
          ["stick.ts", CORPUS_STICK_SOURCE],
        ]),
      },
    ],
    observe: "corpus-pub-works",
    entry: "stick.ts",
    expectWorks: (o) => {
      const publicId = o.services.runtime.types.resolveByName(publicSymbolKey("corpus-pub-works", "Position"));
      assert.ok(publicId, "the entry-published type resolves by its public key");
      assert.equal(
        o.services.runtime.types.resolveByName(qualifiedClassName("corpus-pub-works", "/position.ts", "Position")),
        publicId,
        "the public key aliases the private registration"
      );
      assert.equal(o.program.outputType, publicId, "the sensor's return type is the published type");
      const value = makeRunner(o)();
      assert.ok(value && isStructValue(value), `expected a struct value, got ${JSON.stringify(value)}`);
      assert.equal(value.typeId, publicId, "the returned value carries the published type");
    },
  },
  // -- blocked: TypeScript's own errors -------------------------------------
  {
    name: "use-before-declaration-const",
    files: {
      "entry.ts": numberSensor("return total;", "const total = base + 1;\nconst base = 2;\n"),
    },
    entry: "entry.ts",
    tsError: /used before its declaration/,
  },
  {
    name: "type-error-string-to-number",
    files: {
      "entry.ts": numberSensor("return n;", `const n: number = "five" as unknown as string;\n`),
    },
    entry: "entry.ts",
    tsError: /not assignable/,
  },
  // -- statements and class members ------------------------------------------
  {
    name: "switch-statement",
    files: {
      "entry.ts": numberSensor(
        `const v = 2;
    switch (v) {
      case 2:
        return 1;
      default:
        return 0;
    }`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(1),
  },
  {
    name: "static-class-member",
    files: {
      "entry.ts": numberSensor(
        "return Counted.limit;",
        `class Counted {
  static limit = 4;
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(4),
  },
  {
    name: "class-getter-setter",
    files: {
      "entry.ts": numberSensor(
        "return new Lens().x;",
        `class Lens {
  get x(): number {
    return 1;
  }
}
`
      ),
    },
    entry: "entry.ts",
    expectWorks: runsToNumber(1),
  },
  // -- blocked: forbidden syntax ---------------------------------------------
  {
    name: "class-inheritance",
    files: {
      "entry.ts": numberSensor(
        "return new Sub().n;",
        `class Base {
  n: number;
  constructor() {
    this.n = 1;
  }
}

class Sub extends Base {}
`
      ),
    },
    entry: "entry.ts",
  },
  {
    name: "private-hash-field",
    files: {
      "entry.ts": numberSensor(
        "return new Sealed().read();",
        `class Sealed {
  #x: number;
  constructor() {
    this.#x = 1;
  }
  read(): number {
    return this.#x;
  }
}
`
      ),
    },
    entry: "entry.ts",
  },
  {
    name: "var-declaration",
    files: { "entry.ts": numberSensor("var v = 1;\n    return v;") },
    entry: "entry.ts",
  },
  {
    name: "labeled-statement",
    files: {
      "entry.ts": numberSensor(
        `outer: for (let i = 0; i < 1; i = i + 1) {
      break outer;
    }
    return 0;`
      ),
    },
    entry: "entry.ts",
  },
  {
    name: "delete-expression",
    files: {
      "entry.ts": numberSensor(
        `const p: Sparse = { x: 1 };
    delete p.x;
    return 0;`,
        `interface Sparse {
  x?: number;
}
`
      ),
    },
    entry: "entry.ts",
  },
  {
    name: "regex-literal",
    files: { "entry.ts": numberSensor("const r = /a+/;\n    return 0;") },
    entry: "entry.ts",
  },
  {
    name: "generator-function",
    files: {
      "entry.ts": numberSensor(
        "return 0;",
        `function* gen() {
  yield 1;
}
`
      ),
    },
    entry: "entry.ts",
  },
  {
    name: "class-expression",
    files: { "entry.ts": numberSensor("const C = class {};\n    return 0;") },
    entry: "entry.ts",
  },
  // -- blocked: constructs with their own compiler diagnostics ---------------
  {
    name: "not-on-nullable-primitive-arg",
    files: {
      "entry.ts": `import { Sensor, type Context, optional, param } from "mindcraft";

export default Sensor({
  name: "presence probe",
  args: [optional(param("v", { type: "number", anonymous: true }))],
  onExecute(ctx: Context, args: { v?: number }): number {
    const n = args.v;
    if (!n) {
      return 0;
    }
    return 1;
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "struct-type-config-not-inline-literal",
    files: {
      "position.ts": `import { StructType, type StructOf } from "mindcraft";

const config = {
  name: "position",
  fields: { x: "number", y: "number" },
} as const;

export const Position = StructType(config);
export type Position = StructOf<typeof Position>;
`,
      "entry.ts": `${SENSOR_IMPORT}import { Position } from "./position";

export default Sensor({
  name: "stick position", inline: true,
  onExecute(ctx: Context): Position {
    return Position({ x: 3, y: 4 });
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "struct-type-recursive-field",
    files: {
      "node.ts": `import { StructType, type StructTypeBinding } from "mindcraft";
import { NodeRef } from "./node-ref";

type NodeValue = { next: NodeValue };
export const Node: StructTypeBinding<NodeValue> = StructType({
  name: "node",
  fields: { next: NodeRef },
});
export function nodeDepth(): number {
  return 1;
}
`,
      "node-ref.ts": `export { Node as NodeRef } from "./node";
`,
      "entry.ts": `${SENSOR_IMPORT}import { nodeDepth } from "./node";

export default Sensor({
  name: "node depth", inline: true,
  onExecute(ctx: Context): number {
    return nodeDepth();
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "conversion-same-type",
    files: {
      "entry.ts": `import { Conversion, NumberType } from "mindcraft";

export default Conversion({
  from: NumberType,
  to: NumberType,
  cost: 1,
  convert(value: number): number {
    return value + 1;
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "consumes-when-result-any",
    files: {
      "entry.ts": `${SENSOR_IMPORT}
export default Sensor({
  name: "when reader",
  consumesWhenResult: "any",
  onExecute(ctx: Context): number {
    const r = ctx.getWhenResult();
    return typeof r === "number" ? r : -1;
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "destructured-onexecute-args-param",
    files: {
      "entry.ts": `import { Sensor, type Context, param } from "mindcraft";

export default Sensor({
  name: "destructured args",
  args: [param("a", { type: "number" })],
  onExecute(ctx: Context, { a }: { a: number }): number {
    return a;
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "enum-object-as-value",
    files: {
      "entry.ts": numberSensor(
        "const d = Direction;\n    return 0;",
        `enum Direction {
  Up = "u",
  Down = "d",
}
`
      ),
    },
    entry: "entry.ts",
  },
  {
    name: "class-object-as-value",
    files: {
      "entry.ts": numberSensor(
        "const k = Pt;\n    return 0;",
        `class Pt {
  x: number;
  constructor() {
    this.x = 1;
  }
}
`
      ),
    },
    entry: "entry.ts",
  },
  {
    name: "duplicate-symbol-across-modules",
    files: {
      "a.ts": `export class Util {
  n: number;
  constructor() {
    this.n = 1;
  }
}

export function fa(): number {
  return 1;
}
`,
      "b.ts": `export class Util {
  n: number;
  constructor() {
    this.n = 2;
  }
}

export function fb(): number {
  return 2;
}
`,
      "entry.ts": `${SENSOR_IMPORT}import { fa } from "./a";
import { fb } from "./b";

export default Sensor({
  name: "dup probe", inline: true,
  onExecute(ctx: Context): number {
    return fa() + fb();
  },
});
`,
    },
    entry: "entry.ts",
  },
  {
    name: "duplicate-stable-id",
    files: {
      "a.ts": `${SENSOR_IMPORT}
export default Sensor({
  name: "first claimant", inline: true,
  id: "dupStableId00001",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
      "b.ts": `${SENSOR_IMPORT}
export default Sensor({
  name: "second claimant", inline: true,
  id: "dupStableId00001",
  onExecute(ctx: Context): number {
    return 2;
  },
});
`,
    },
    entry: "b.ts",
  },
  {
    name: "shared-modifier-label-conflict",
    files: {
      "a.ts": `import { Sensor, modifier, optional, type Context } from "mindcraft";

export default Sensor({
  name: "first label",
  id: "modLabelA0000001",
  args: [optional(modifier("modifier.corpus.gear", { label: "fast" }))],
  onExecute(ctx: Context): number {
    return 1;
  },
});
`,
      "b.ts": `import { Sensor, modifier, optional, type Context } from "mindcraft";

export default Sensor({
  name: "second label",
  id: "modLabelB0000001",
  args: [optional(modifier("modifier.corpus.gear", { label: "slow" }))],
  onExecute(ctx: Context): number {
    return 2;
  },
});
`,
    },
    entry: "b.ts",
  },
  {
    name: "entry-duplicate-export-name",
    files: {
      "a.ts": `export const Widget = 1;\n`,
      "b.ts": `export const Widget = 2;\n`,
      "index.ts": `export { Widget } from "./a";\nexport { Widget } from "./b";\n`,
      "entry.ts": numberSensor("return 1;"),
    },
    entry: "entry.ts",
    tsError: /Duplicate identifier 'Widget'/,
  },
  {
    name: "entry-publishes-declaration-under-two-aliases",
    files: {},
    roots: [
      {
        namespace: "corpus-pub-alias",
        files: new Map([
          ["position.ts", CORPUS_POSITION_SOURCE],
          ["index.ts", `export { Position, Position as Pos } from "./position";\n`],
        ]),
      },
    ],
    observe: "corpus-pub-alias",
    entry: "index.ts",
  },
  {
    name: "published-type-references-unpublished-type",
    files: {},
    roots: [
      {
        namespace: "corpus-pub-closure",
        files: new Map([
          [
            "types.ts",
            `import { NumberType, StructType } from "mindcraft";

const Inner = StructType({
  name: "inner",
  fields: { n: NumberType },
});

export const Outer = StructType({
  name: "outer",
  fields: { inner: Inner },
});
`,
          ],
          ["index.ts", `export { Outer } from "./types";\n`],
        ]),
      },
    ],
    observe: "corpus-pub-closure",
    entry: "index.ts",
  },
  {
    name: "extension-deep-import",
    files: {},
    roots: [
      {
        namespace: "corpus/deep-lib",
        files: new Map([
          ["position.ts", CORPUS_POSITION_SOURCE],
          ["index.ts", `export { Position } from "./position";\n`],
        ]),
      },
      {
        namespace: "corpus-deep-app",
        files: new Map([
          [
            "main.ts",
            `import { Sensor, type Context } from "mindcraft";
import { Position } from "@ext/corpus/deep-lib/position";

export default Sensor({
  name: "deep import probe", inline: true,
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 1, y: 2 });
  },
});
`,
          ],
        ]),
        dependencies: [{ coordinate: "corpus/deep-lib" }],
      },
    ],
    observe: "corpus-deep-app",
    entry: "main.ts",
  },
];

/** Every error-severity diagnostic across all per-file results. */
function allErrorDiagnostics(result: ProjectCompileResult): CompileDiagnostic[] {
  const all: CompileDiagnostic[] = [];
  for (const compiled of result.results.values()) {
    for (const d of compiled.diagnostics) {
      if (d.severity === "error") {
        all.push(d);
      }
    }
  }
  return all;
}

function assertBlocked(entry: CorpusEntry, code: number): void {
  const { result } = compileFiles(entry);

  if (code === CompileDiagCode.TypeScriptError) {
    const tsMessages = [...result.tsErrors.values()].flat().map((d) => d.message);
    assert.ok(
      tsMessages.length > 0,
      `BLOCKED entry "${entry.name}" no longer fails TypeScript's own check; reclassify it (delete from BLOCKED, pin its new state).`
    );
    assert.ok(entry.tsError, `entry "${entry.name}" is pinned to TypeScriptError and must declare its tsError pattern`);
    assert.ok(
      tsMessages.some((m) => entry.tsError!.test(m)),
      `BLOCKED entry "${entry.name}" fails, but TypeScript's own error changed: expected ${entry.tsError}, got ${JSON.stringify(tsMessages)}`
    );
    return;
  }

  assert.equal(
    result.tsErrors.size,
    0,
    `entry "${entry.name}" hit TypeScript errors before its pinned diagnostic could be observed: ${JSON.stringify([...result.tsErrors])}`
  );
  const errors = allErrorDiagnostics(result);
  if (errors.some((d) => d.code === code)) {
    return;
  }
  if (errors.length === 0) {
    assert.fail(
      `BLOCKED entry "${entry.name}" now compiles clean; move it BLOCKED -> WORKS (delete from BLOCKED, add to WORKS with an outcome assertion).`
    );
  }
  assert.fail(
    `BLOCKED entry "${entry.name}" fails, but its pinned diagnostic ${code} was not emitted; got codes ${JSON.stringify(errors.map((d) => d.code))}.`
  );
}

/** Whether the entry currently meets its WORKS pin (clean compile plus passing outcome assertion). */
function conforms(entry: CorpusEntry): boolean {
  try {
    const outcome = compileWorks(entry);
    entry.expectWorks!(outcome);
    return true;
  } catch {
    return false;
  }
}

describe("ts-equivalence conformance corpus", () => {
  const byName = new Map(CORPUS.map((e) => [e.name, e]));
  const worksSet = new Set(WORKS);
  const blockedSet = new Set(Object.keys(BLOCKED));
  const quarantinedSet = new Set(Object.keys(QUARANTINED));

  test("the corpus and manifest agree", () => {
    assert.equal(byName.size, CORPUS.length, "corpus entry names must be unique");
    for (const entry of CORPUS) {
      const listings =
        Number(worksSet.has(entry.name)) + Number(blockedSet.has(entry.name)) + Number(quarantinedSet.has(entry.name));
      assert.equal(
        listings,
        1,
        `corpus entry "${entry.name}" must be classified in exactly one manifest list (found in ${listings})`
      );
      if (worksSet.has(entry.name) || quarantinedSet.has(entry.name)) {
        assert.ok(entry.expectWorks, `entry "${entry.name}" needs an expectWorks outcome assertion`);
      }
    }
    for (const name of [...worksSet, ...blockedSet, ...quarantinedSet]) {
      assert.ok(byName.has(name), `manifest name "${name}" has no corpus entry`);
    }
  });

  for (const entry of CORPUS) {
    test(entry.name, () => {
      if (worksSet.has(entry.name)) {
        const outcome = compileWorks(entry);
        entry.expectWorks!(outcome);
        return;
      }
      if (blockedSet.has(entry.name)) {
        assertBlocked(entry, BLOCKED[entry.name]);
        return;
      }
      if (quarantinedSet.has(entry.name)) {
        assert.ok(
          !conforms(entry),
          `QUARANTINED entry "${entry.name}" now conforms; delete it from QUARANTINED and add it to WORKS.`
        );
      }
    });
  }
});
