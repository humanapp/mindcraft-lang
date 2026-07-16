/**
 * Entry-module publication and cross-project type resolution: public
 * `<namespace>::<name>` keys alias private registrations (one type id per
 * declaration), `@lib/<owner>/<repo>` imports resolve to a dependency's entry module,
 * every name surface resolves an extension-imported type to the DECLARING
 * project's key, and the publication diagnostics (deep import, multiple
 * published names, unpublished type reference) emit precisely. The
 * three-root fixture pins the founding requirement end-to-end: a sensor's
 * output type and an actuator's param type from different roots are one type
 * id, at compile and through a running brain.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type BrainServices,
  type IBrainTileDef,
  mkVariableFactoryTileId,
  mkVariableTileId,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type BrainTileFactoryDef, BrainTileOperatorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import {
  CoreTypeIds,
  extractNumberValue,
  type IBrain,
  NativeType,
  type StructTypeDef,
  type TypeId,
  type Value,
} from "@mindcraft-lang/core/runtime";
import { registerUserTile } from "../runtime/registration-bridge.js";
import { buildUserTileMetadata } from "../runtime/user-tile-metadata.js";
import { collectParams } from "./arg-spec-utils.js";
import { CompileDiagCode } from "./diag-codes.js";
import type { ProjectDependency } from "./extension-mounts.js";
import { type ProjectCompileResult, UserTileProject } from "./project.js";
import { MultiRootSession, type ProjectRoot } from "./project-set.js";
import { publicSymbolKey, qualifiedClassName } from "./symbol-keys.js";
import type { CompileDiagnostic, UserAuthoredProgram } from "./types.js";

const POSITION_NS = "acme/position";
const GAMEPAD_NS = "acme/gamepad";
const HOST_NS = "host-store-0001";

const POSITION_SOURCE = `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
  variables: true,
});
export type Position = StructOf<typeof Position>;
`;

const POSITION_ENTRY = `export { Position } from "./position";
`;

const GAMEPAD_STICK_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";

export default Sensor({
  name: "stick position", inline: true,
  id: "stickPosition001",
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 3, y: 4 });
  },
});
`;

const HOST_SEEN_SOURCE = `import { System } from "mindcraft";

export const Seen = System({
  name: "seen",
  state: { code: 0 },
  record(n: number) {
    this.code = n;
  },
});
`;

const HOST_MOVE_SOURCE = `import { Actuator, param, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";
import { Seen } from "./seen";

export default Actuator({
  name: "move to",
  id: "moveToPosition01",
  args: [param("pos", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { pos: Position }) {
    Seen.record(args.pos.x * 100 + args.pos.y);
  },
});
`;

const HOST_READ_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Seen } from "./seen";

export default Sensor({
  name: "read seen", inline: true,
  id: "readSeenCode0001",
  onExecute(ctx: Context): number {
    return Seen.code;
  },
});
`;

function files(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries));
}

function dep(coordinate: string): ProjectDependency {
  return { coordinate };
}

function positionRoot(): ProjectRoot {
  return {
    namespace: POSITION_NS,
    files: files({ "position.ts": POSITION_SOURCE, "index.ts": POSITION_ENTRY }),
  };
}

function newSession(): { services: BrainServices; session: MultiRootSession } {
  const services = __test__createBrainServices();
  const session = new MultiRootSession({ services });
  return { services, session };
}

function allDiagnostics(result: ProjectCompileResult): CompileDiagnostic[] {
  const all: CompileDiagnostic[] = [];
  for (const [, entry] of result.results) {
    all.push(...entry.diagnostics);
  }
  for (const [, diags] of result.tsErrors) {
    all.push(...diags);
  }
  return all;
}

function assertClean(result: ProjectCompileResult, label: string): void {
  assert.deepEqual(allDiagnostics(result), [], `expected a clean compile for ${label}`);
}

function compiledProgram(result: ProjectCompileResult, path: string): UserAuthoredProgram {
  const entry = result.results.get(path);
  assert.ok(entry?.program, `expected a compiled program for ${path}`);
  return entry.program;
}

function diagnosticsOf(result: ProjectCompileResult, path: string): CompileDiagnostic[] {
  return result.results.get(path)?.diagnostics ?? [];
}

function positionTypeId(services: BrainServices): TypeId {
  const typeId = services.runtime.types.resolveByName(qualifiedClassName(POSITION_NS, "/position.ts", "Position"));
  assert.ok(typeId, "expected the position struct to be registered");
  return typeId;
}

function actionTileFor(services: BrainServices, program: UserAuthoredProgram): IBrainTileDef {
  registerUserTile(program, services);
  const metadata = buildUserTileMetadata(program, (name) => services.runtime.types.resolveByName(name));
  assert.ok(metadata, `expected tile metadata for ${program.key}`);
  return metadata.actionTile;
}

function manufactureVariable(services: BrainServices, typeId: TypeId, name: string): BrainTileVariableDef {
  const factory = services.edit.tiles.get(mkVariableFactoryTileId(typeId)) as BrainTileFactoryDef | undefined;
  assert.ok(factory, "expected the variable factory tile to be registered");
  const varTile = factory.manufacture(factory, { name });
  assert.ok(varTile, "expected the factory to manufacture a variable tile");
  return varTile as BrainTileVariableDef;
}

function newBrain(services: BrainServices): { brainDef: BrainDef; page: BrainPageDef; rule: BrainRuleDef } {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  const page = pageResult.value!.page as BrainPageDef;
  return { brainDef, page, rule: page.children().get(0)! as BrainRuleDef };
}

function appendTiles(rule: BrainRuleDef, tiles: readonly IBrainTileDef[]): void {
  for (const tile of tiles) {
    rule.do().appendTile(tile as never);
  }
}

function runBrain(brainDef: BrainDef, ticks: number): IBrain {
  const brain = brainDef.compile();
  brain.initialize();
  brain.startup();
  for (let i = 0; i < ticks; i++) {
    brain.think((i + 1) * 16);
  }
  return brain;
}

function num(brain: IBrain, name: string): number | undefined {
  const v: Value | undefined = brain.getVariable(name);
  return v === undefined ? undefined : extractNumberValue(v);
}

describe("entry-module publication", () => {
  test("an entry-published type gains a public key aliasing its private registration (one type id)", () => {
    const { services, session } = newSession();
    session.setRoots([positionRoot()]);
    const { roots } = session.compile();
    assertClean(roots.get(POSITION_NS)!, POSITION_NS);

    const types = services.runtime.types;
    const privateId = types.resolveByName(qualifiedClassName(POSITION_NS, "/position.ts", "Position"));
    const publicId = types.resolveByName(publicSymbolKey(POSITION_NS, "Position"));
    assert.ok(privateId, "the type-library root registers its struct without any tile referencing it");
    assert.equal(publicId, privateId, "both keys resolve to the one type id");
    assert.deepEqual(
      [...roots.get(POSITION_NS)!.publishedTypes!.entries()],
      [[publicSymbolKey(POSITION_NS, "Position"), privateId]],
      "the compile result reports the published surface"
    );
  });

  test("a root with no entry module publishes nothing", () => {
    const { services, session } = newSession();
    session.setRoots([{ namespace: POSITION_NS, files: files({ "position.ts": POSITION_SOURCE }) }]);
    const { roots } = session.compile();
    assertClean(roots.get(POSITION_NS)!, POSITION_NS);
    assert.equal(roots.get(POSITION_NS)!.publishedTypes?.size, 0);
    assert.equal(services.runtime.types.resolveByName(publicSymbolKey(POSITION_NS, "Position")), undefined);
  });

  test("a standalone project compile never publishes, even with an entry module", () => {
    const services = __test__createBrainServices();
    const project = new UserTileProject({ projectNamespace: POSITION_NS, services });
    project.setFiles(files({ "position.ts": POSITION_SOURCE, "index.ts": POSITION_ENTRY }));
    const result = project.compileAll();
    assert.equal(result.publishedTypes, undefined);
    assert.equal(services.runtime.types.resolveByName(publicSymbolKey(POSITION_NS, "Position")), undefined);
  });

  test("an entry alias publishes under the exported name; renaming the export renames the public key", () => {
    const { services, session } = newSession();
    session.setRoots([
      {
        namespace: POSITION_NS,
        files: files({
          "position.ts": POSITION_SOURCE,
          "index.ts": `export { Position as Pos } from "./position";\n`,
        }),
      },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(POSITION_NS)!, POSITION_NS);
    const types = services.runtime.types;
    assert.equal(
      types.resolveByName(publicSymbolKey(POSITION_NS, "Pos")),
      types.resolveByName(qualifiedClassName(POSITION_NS, "/position.ts", "Position"))
    );
    assert.equal(types.resolveByName(publicSymbolKey(POSITION_NS, "Position")), undefined);
  });

  test("every name-keyed kind publishes: enum, class, interface, type alias, StructType", () => {
    const { services, session } = newSession();
    const ns = "acme/kinds";
    session.setRoots([
      {
        namespace: ns,
        files: files({
          "defs.ts": `import { NumberType, StructType } from "mindcraft";

export enum Mode {
  Stop = 0,
  Go = 1,
}

export class Pt {
  x: number;
  constructor() {
    this.x = 1;
  }
}

export interface Reading {
  value: number;
}

export type Sample = { n: number };

export const Vec = StructType({
  name: "vec",
  fields: { x: NumberType },
});
`,
          "index.ts": `export { Mode, Pt, Reading, Sample, Vec } from "./defs";\n`,
        }),
      },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(ns)!, ns);

    const types = services.runtime.types;
    for (const name of ["Mode", "Pt", "Reading", "Sample", "Vec"]) {
      const privateId = types.resolveByName(qualifiedClassName(ns, "/defs.ts", name));
      assert.ok(privateId, `expected '${name}' to be registered`);
      assert.equal(types.resolveByName(publicSymbolKey(ns, name)), privateId, `public key for '${name}'`);
    }
  });

  test("an entry re-exporting a dependency's published type publishes it under its own key, same type id", () => {
    const { services, session } = newSession();
    session.setRoots([
      positionRoot(),
      {
        namespace: GAMEPAD_NS,
        files: files({
          "stick.ts": GAMEPAD_STICK_SOURCE,
          "index.ts": `export { Position } from "@lib/acme/position";\n`,
        }),
        dependencies: [dep(POSITION_NS)],
      },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(POSITION_NS)!, POSITION_NS);
    assertClean(roots.get(GAMEPAD_NS)!, GAMEPAD_NS);

    const types = services.runtime.types;
    assert.equal(
      types.resolveByName(publicSymbolKey(GAMEPAD_NS, "Position")),
      positionTypeId(services),
      "the re-published key resolves to the declaring project's type id"
    );
  });

  test("removing a root from the session drops its public keys; recompiling restores the same type id", () => {
    const { services, session } = newSession();
    session.setRoots([positionRoot()]);
    session.compile();
    const types = services.runtime.types;
    const publicKey = publicSymbolKey(POSITION_NS, "Position");
    const firstId = types.resolveByName(publicKey);
    assert.ok(firstId);

    session.setRoots([]);
    assert.equal(types.resolveByName(publicKey), undefined, "the public key follows the removed registration");

    session.setRoots([positionRoot()]);
    session.compile();
    assert.equal(types.resolveByName(publicKey), firstId, "re-adding the root restores the identical type id");
  });
});

describe("publication diagnostics", () => {
  test("one declaration exported under two names is rejected, naming both aliases", () => {
    const { session } = newSession();
    session.setRoots([
      {
        namespace: POSITION_NS,
        files: files({
          "position.ts": POSITION_SOURCE,
          "index.ts": `export { Position, Position as Pos } from "./position";\n`,
        }),
      },
    ]);
    const { roots } = session.compile();
    const diags = diagnosticsOf(roots.get(POSITION_NS)!, "index.ts");
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.MultiplePublishedNames);
    assert.match(diags[0].message, /"Position"/);
    assert.match(diags[0].message, /"Pos"/);
  });

  test("a published type referencing an unpublished own type is rejected with the export-it fix", () => {
    const { session } = newSession();
    const ns = "acme/closure";
    session.setRoots([
      {
        namespace: ns,
        files: files({
          "types.ts": `import { NumberType, StructType } from "mindcraft";

const Inner = StructType({
  name: "inner",
  fields: { n: NumberType },
});

export const Outer = StructType({
  name: "outer",
  fields: { inner: Inner },
});
`,
          "index.ts": `export { Outer } from "./types";\n`,
        }),
      },
    ]);
    const { roots } = session.compile();
    const diags = diagnosticsOf(roots.get(ns)!, "index.ts");
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.UnpublishedTypeReference);
    assert.match(diags[0].message, /published type 'Outer'/);
    assert.match(diags[0].message, /'Inner'/);
    assert.match(diags[0].message, /Export it from the entry module/);
  });

  test("a publishing project's tile referencing an unpublished own type is rejected at the tile", () => {
    const { session } = newSession();
    const ns = "acme/tile-closure";
    session.setRoots([
      {
        namespace: ns,
        files: files({
          "vec.ts": `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Vec = StructType({
  name: "vec",
  fields: { x: NumberType },
});
export type Vec = StructOf<typeof Vec>;
`,
          "probe.ts": `import { Sensor, type Context } from "mindcraft";
import { Vec } from "./vec";

export default Sensor({
  name: "vec probe",
  id: "vecProbe00000001",
  returnType: Vec,
  onExecute(ctx: Context): Vec {
    return Vec({ x: 1 });
  },
});
`,
          "index.ts": `export {};\n`,
        }),
      },
    ]);
    const { roots } = session.compile();
    const diags = diagnosticsOf(roots.get(ns)!, "probe.ts");
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.UnpublishedTypeReference);
    assert.match(diags[0].message, /tile 'vec probe'/);
    assert.match(diags[0].message, /'Vec'/);
  });

  test("a published System whose state references an unpublished type is rejected; exporting the type fixes it", () => {
    const ns = "acme/system-closure";
    const stateSource = (exportHidden: string) => `import { NumberType, StructType, System } from "mindcraft";

${exportHidden}const Hidden = StructType({
  name: "hidden",
  fields: { n: NumberType },
});

export const Nav = System({
  name: "nav",
  state: { at: Hidden({ n: 0 }) },
});
`;
    {
      const { session } = newSession();
      session.setRoots([
        {
          namespace: ns,
          files: files({ "nav.ts": stateSource(""), "index.ts": `export { Nav } from "./nav";\n` }),
        },
      ]);
      const diags = diagnosticsOf(session.compile().roots.get(ns)!, "index.ts");
      assert.equal(diags.length, 1, JSON.stringify(diags));
      assert.equal(diags[0].code, CompileDiagCode.UnpublishedTypeReference);
      assert.match(diags[0].message, /'Hidden'/);
    }
    {
      const { session } = newSession();
      session.setRoots([
        {
          namespace: ns,
          files: files({
            "nav.ts": stateSource("export "),
            "index.ts": `export { Nav, Hidden } from "./nav";\n`,
          }),
        },
      ]);
      assertClean(session.compile().roots.get(ns)!, ns);
    }
  });

  test("referencing another root's unpublished type is rejected; its published types are fine", () => {
    const { session } = newSession();
    const consumerNs = "acme/consumer";
    const consumerSource = `import { Sensor, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";

export default Sensor({
  name: "secret probe",
  id: "secretProbe00001",
  returnType: "${POSITION_NS}:/secret.ts::Secret",
  onExecute(ctx: Context): Position {
    return Position({ x: 1, y: 2 });
  },
});
`;
    session.setRoots([
      {
        namespace: POSITION_NS,
        files: files({
          "position.ts": POSITION_SOURCE,
          "secret.ts": `import { NumberType, StructType } from "mindcraft";

export const Secret = StructType({
  name: "secret",
  fields: { n: NumberType },
});
`,
          "index.ts": `export { Position } from "./position";\nimport "./secret";\n`,
        }),
      },
      {
        namespace: consumerNs,
        files: files({ "probe.ts": consumerSource, "index.ts": `export {};\n` }),
        dependencies: [dep(POSITION_NS)],
      },
    ]);
    const { roots } = session.compile();
    const diags = diagnosticsOf(roots.get(consumerNs)!, "probe.ts");
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.UnpublishedTypeReference);
    assert.match(diags[0].message, /'Secret'/);
    assert.match(diags[0].message, new RegExp(`from "${POSITION_NS.replace("/", "\\/")}"`));
    assert.match(diags[0].message, /does not publish/);
  });

  test("a deep extension import is rejected with the entry-surface fix", () => {
    const { session } = newSession();
    const consumerNs = "acme/deep";
    session.setRoots([
      positionRoot(),
      {
        namespace: consumerNs,
        files: files({
          "main.ts": `import { Sensor, type Context } from "mindcraft";
import { Position } from "@lib/acme/position/position";

export default Sensor({
  name: "deep probe",
  id: "deepProbe0000001",
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 1, y: 2 });
  },
});
`,
        }),
        dependencies: [dep(POSITION_NS)],
      },
    ]);
    const { roots } = session.compile();
    const diags = diagnosticsOf(roots.get(consumerNs)!, "main.ts");
    assert.equal(diags.length, 1, JSON.stringify(diags));
    assert.equal(diags[0].code, CompileDiagCode.ExtensionDeepImport);
    assert.match(diags[0].message, /"@lib\/acme\/position\/position"/);
    assert.match(diags[0].message, /import the extension's published surface from "@lib\/acme\/position"/i);
    assert.ok(diags[0].line, "the diagnostic carries the import's source span");
  });

  test("a single-segment extension import names no coordinate and fails to resolve", () => {
    const { session } = newSession();
    const consumerNs = "acme/single";
    session.setRoots([
      positionRoot(),
      {
        namespace: consumerNs,
        files: files({
          "main.ts": `import { Sensor, type Context } from "mindcraft";
import { Position } from "@lib/position";

export default Sensor({
  name: "single probe",
  id: "singleProbe00001",
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 1, y: 2 });
  },
});
`,
        }),
        dependencies: [dep(POSITION_NS)],
      },
    ]);
    const { roots } = session.compile();
    // A one-segment specifier is not an extension coordinate: it does not
    // resolve to the mounted dependency and surfaces as an ordinary
    // module-not-found TypeScript error, never a silent success.
    const tsErrors = roots.get(consumerNs)!.tsErrors.get("main.ts") ?? [];
    assert.ok(
      tsErrors.some((diag) => /Cannot find module '@lib\/position'/.test(diag.message)),
      `expected an unresolved-module error, got ${JSON.stringify(tsErrors)}`
    );
  });

  test("the retired `@ext/` import prefix no longer resolves to a mounted dependency", () => {
    const { session } = newSession();
    const consumerNs = "acme/retired";
    session.setRoots([
      positionRoot(),
      {
        namespace: consumerNs,
        files: files({
          "main.ts": `import { Sensor, type Context } from "mindcraft";
import { Position } from "@ext/acme/position";

export default Sensor({
  name: "retired probe",
  id: "retiredProbe0001",
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 1, y: 2 });
  },
});
`,
        }),
        dependencies: [dep(POSITION_NS)],
      },
    ]);
    const { roots } = session.compile();
    const tsErrors = roots.get(consumerNs)!.tsErrors.get("main.ts") ?? [];
    assert.ok(
      tsErrors.some((diag) => /Cannot find module '@ext\/acme\/position'/.test(diag.message)),
      `the old prefix must fail to resolve, got ${JSON.stringify(tsErrors)}`
    );
  });
});

describe("declaring-project-aware type resolution", () => {
  /** Compiles the position library plus one consumer root and returns the consumer's result. */
  function compileConsumer(consumerFiles: Record<string, string>): {
    services: BrainServices;
    result: ProjectCompileResult;
  } {
    const { services, session } = newSession();
    const consumerNs = "acme/consumer";
    session.setRoots([
      positionRoot(),
      {
        namespace: consumerNs,
        files: files(consumerFiles),
        dependencies: [dep(POSITION_NS)],
      },
    ]);
    const { roots } = session.compile();
    assertClean(roots.get(POSITION_NS)!, POSITION_NS);
    const result = roots.get(consumerNs)!;
    return { services, result };
  }

  test("returnType and a struct factory call resolve to the declaring project's type", () => {
    const { services, result } = compileConsumer({ "stick.ts": GAMEPAD_STICK_SOURCE });
    assertClean(result, "consumer");
    const program = compiledProgram(result, "stick.ts");
    assert.equal(program.outputType, positionTypeId(services));
  });

  test("an anonymous param type resolves to the declaring project's type", () => {
    const { services, result } = compileConsumer({
      "reader.ts": `import { Sensor, param, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";

export default Sensor({
  name: "read x",
  id: "readX0000000001",
  args: [param("pos", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { pos: Position }): number {
    return args.pos.x;
  },
});
`,
    });
    assertClean(result, "consumer");
    const program = compiledProgram(result, "reader.ts");
    const paramType = collectParams(program.args)[0].type;
    assert.equal(services.runtime.types.resolveByName(paramType), positionTypeId(services));
  });

  test("a declared output type resolves to the declaring project's type", () => {
    const { services, result } = compileConsumer({
      "spotter.ts": `import { Sensor, setOutput, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";

export default Sensor({
  name: "spotter",
  id: "spotter00000001",
  outputs: [{ name: "spot", type: Position }],
  onExecute(ctx: Context): number {
    setOutput(ctx, "spot", Position({ x: 1, y: 2 }));
    return 1;
  },
});
`,
    });
    assertClean(result, "consumer");
    const program = compiledProgram(result, "spotter.ts");
    const outputType = program.outputs?.[0]?.type;
    assert.ok(outputType);
    assert.equal(services.runtime.types.resolveByName(outputType), positionTypeId(services));
  });

  test("consumesWhenResult resolves to the declaring project's type", () => {
    const { services, result } = compileConsumer({
      "chase.ts": `import { Actuator, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";

export default Actuator({
  name: "chase",
  id: "chase0000000001",
  consumesWhenResult: Position,
  onExecute(ctx: Context) {},
});
`,
    });
    assertClean(result, "consumer");
    const program = compiledProgram(result, "chase.ts");
    assert.equal(program.consumesWhenResult, positionTypeId(services));
  });

  test("a StructType field typed by an extension import resolves to the declaring project's type", () => {
    const { services, result } = compileConsumer({
      "track.ts": `import { NumberType, Sensor, StructType, type Context, type StructOf } from "mindcraft";
import { Position } from "@lib/acme/position";

export const Track = StructType({
  name: "track",
  fields: { at: Position, score: NumberType },
});
export type Track = StructOf<typeof Track>;

export default Sensor({
  name: "track probe",
  id: "trackProbe000001",
  returnType: Track,
  onExecute(ctx: Context): Track {
    return Track({ at: Position({ x: 1, y: 2 }), score: 5 });
  },
});
`,
    });
    assertClean(result, "consumer");
    const program = compiledProgram(result, "track.ts");
    const trackDef = services.runtime.types.get(program.outputType!) as StructTypeDef;
    assert.equal(trackDef.coreType, NativeType.Struct);
    const atField = trackDef.fields.find((field) => field.name === "at");
    assert.equal(atField?.typeId, positionTypeId(services));
  });

  test("a System state field typed by an extension import resolves to the declaring project's type", () => {
    const { services, result } = compileConsumer({
      "nav.ts": `import { Sensor, System, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";

const Nav = System({
  name: "nav",
  state: { home: Position({ x: 7, y: 9 }) },
});

export default Sensor({
  name: "home x", inline: true,
  id: "homeX0000000001",
  onExecute(ctx: Context): number {
    return Nav.home.x;
  },
});
`,
    });
    assertClean(result, "consumer");
    const stateStructId = services.runtime.types.resolveByName(`{home:${positionTypeId(services)}}`);
    assert.ok(stateStructId, "the System state struct's field carries the declaring project's type id");
  });

  test("a Conversion from-type resolves to the declaring project's type", () => {
    const { services, result } = compileConsumer({
      "pos-to-buffer.ts": `import { BufferType, Conversion } from "mindcraft";
import { Position } from "@lib/acme/position";

export default Conversion({
  id: "convPosBuf000001",
  from: Position,
  to: BufferType,
  cost: 2,
  convert(pos: Position): Buffer {
    return Buffer.from([pos.x, pos.y]);
  },
});
`,
    });
    assertClean(result, "consumer");
    const program = compiledProgram(result, "pos-to-buffer.ts");
    assert.equal(program.conversion?.fromType, positionTypeId(services));
  });

  test("two consumers importing the same dependency by its coordinate resolve one type", () => {
    const { services, session } = newSession();
    const otherNs = "acme/other";
    session.setRoots([
      positionRoot(),
      {
        namespace: GAMEPAD_NS,
        files: files({ "stick.ts": GAMEPAD_STICK_SOURCE }),
        dependencies: [dep(POSITION_NS)],
      },
      {
        namespace: otherNs,
        files: files({
          "probe.ts": `import { Sensor, type Context } from "mindcraft";
import { Position } from "@lib/acme/position";

export default Sensor({
  name: "other probe",
  id: "otherProbe000001",
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 1, y: 2 });
  },
});
`,
        }),
        dependencies: [dep(POSITION_NS)],
      },
    ]);
    const { roots } = session.compile();
    for (const [namespace, result] of roots) {
      assertClean(result, namespace);
    }
    const stick = compiledProgram(roots.get(GAMEPAD_NS)!, "stick.ts");
    const probe = compiledProgram(roots.get(otherNs)!, "probe.ts");
    assert.equal(stick.outputType, probe.outputType);
    assert.equal(stick.outputType, positionTypeId(services));
  });
});

describe("cross-project composition end to end", () => {
  test("a sensor's output and an actuator's param from different roots are one type, through a running brain", () => {
    const { services, session } = newSession();
    session.setRoots([
      positionRoot(),
      {
        namespace: GAMEPAD_NS,
        files: files({ "stick.ts": GAMEPAD_STICK_SOURCE }),
        dependencies: [dep(POSITION_NS)],
      },
      {
        namespace: HOST_NS,
        files: files({ "seen.ts": HOST_SEEN_SOURCE, "move.ts": HOST_MOVE_SOURCE, "read.ts": HOST_READ_SOURCE }),
        dependencies: [dep(POSITION_NS), dep(GAMEPAD_NS)],
      },
    ]);
    const { roots } = session.compile();
    for (const [namespace, result] of roots) {
      assertClean(result, namespace);
    }

    const typeId = positionTypeId(services);
    const stick = compiledProgram(roots.get(GAMEPAD_NS)!, "stick.ts");
    const move = compiledProgram(roots.get(HOST_NS)!, "move.ts");
    const read = compiledProgram(roots.get(HOST_NS)!, "read.ts");

    // Compile-time identity: the sensor's output type IS the actuator's param type.
    assert.equal(stick.outputType, typeId);
    assert.equal(services.runtime.types.resolveByName(collectParams(move.args)[0].type), typeId);
    assert.equal(services.runtime.types.resolveByName(publicSymbolKey(POSITION_NS, "Position")), typeId);

    // Runtime identity: the sensor's value crosses into the actuator's param slot.
    const stickTile = actionTileFor(services, stick);
    const moveTile = actionTileFor(services, move);
    const readTile = actionTileFor(services, read);
    const opAssign = new BrainTileOperatorDef("assign", {}, services);
    const posVar = manufactureVariable(services, typeId, "stick-pos");

    const { brainDef, page, rule } = newBrain(services);
    brainDef.catalog().registerTileDef(posVar);
    appendTiles(rule, [posVar, opAssign, stickTile]);
    appendTiles(page.appendNewRule(), [moveTile, posVar]);
    const seenVar = new BrainTileVariableDef(
      mkVariableTileId("seen-code"),
      "seen-code",
      CoreTypeIds.Number,
      "seen-code"
    );
    appendTiles(page.appendNewRule(), [seenVar, opAssign, readTile]);

    const brain = runBrain(brainDef, 1);
    assert.equal(num(brain, "seen-code"), 304, "the actuator observed the sensor's Position value (3 * 100 + 4)");
  });
});
