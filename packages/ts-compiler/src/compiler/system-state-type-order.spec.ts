/**
 * System state field types: a `state` field may be typed by a user class,
 * interface, type alias, enum, or StructType declaration, and the compile
 * outcome never depends on declaration order or import-visit order. Field
 * types resolve to the qualified registered type (never a bare-name shadow
 * registration), and state values read back end to end through a running
 * brain across thinks.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type BrainServices, type IBrainTileDef, mkVariableTileId } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileOperatorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds, extractNumberValue, type IBrain, NativeType, type Value } from "@mindcraft-lang/core/runtime";
import { registerUserTile } from "../runtime/registration-bridge.js";
import { buildUserTileMetadata } from "../runtime/user-tile-metadata.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { LoweringDiagCode } from "./diag-codes.js";
import { type ProjectCompileResult, UserTileProject } from "./project.js";
import type { UserAuthoredProgram } from "./types.js";

function compileProject(services: BrainServices, files: Record<string, string>): ProjectCompileResult {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({ ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }], services });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

function compiledProgram(result: ProjectCompileResult, path: string): UserAuthoredProgram {
  assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
  const entry = result.results.get(path);
  assert.ok(entry, `expected a result for ${path}`);
  assert.deepEqual(entry.diagnostics, [], `Diagnostics for ${path}: ${JSON.stringify(entry.diagnostics)}`);
  assert.ok(entry.program, `expected a compiled program for ${path}`);
  return entry.program;
}

function compileTile(services: BrainServices, files: Record<string, string>, entryPath: string): IBrainTileDef {
  const result = compileProject(services, files);
  const program = compiledProgram(result, entryPath);
  registerUserTile(program, services);
  const metadata = buildUserTileMetadata(program, (name) => services.runtime.types.resolveByName(name));
  assert.ok(metadata, `expected tile metadata for ${program.key}`);
  return metadata.actionTile;
}

/** Assert the project fails with TypeScript's own error and no compiler crash. */
function expectTsError(services: BrainServices, files: Record<string, string>): void {
  const result = compileProject(services, files);
  assert.ok(result.tsErrors.size > 0, "expected TypeScript's own use-before-declaration error");
}

/** Assert the type registered under its qualified name and never under its bare name. */
function expectQualifiedOnly(services: BrainServices, qualifiedName: string, bareName: string): string {
  const typeId = services.runtime.types.resolveByName(qualifiedName);
  assert.ok(typeId, `expected ${qualifiedName} to be registered`);
  assert.equal(
    services.runtime.types.resolveByName(bareName),
    undefined,
    `no bare-name shadow type registers for ${bareName}`
  );
  return typeId;
}

/** Assert the System's state struct registered with the field carrying the given type. */
function expectStateField(services: BrainServices, fieldName: string, fieldTypeId: string): void {
  const stateTypeId = services.runtime.types.resolveByName(`{${fieldName}:${fieldTypeId}}`);
  assert.ok(stateTypeId, `expected the state struct field '${fieldName}' to carry type ${fieldTypeId}`);
  const def = services.runtime.types.get(stateTypeId);
  assert.ok(def);
  assert.equal(def.coreType, NativeType.Struct);
}

function mkNumVar(name: string): BrainTileVariableDef {
  const uniqueId = `sys-state-${name}`;
  return new BrainTileVariableDef(mkVariableTileId(uniqueId), name, CoreTypeIds.Number, uniqueId);
}

/** Run a one-rule brain (var = tile) for `ticks` thinks and read the var back. */
function runSensorThinks(
  services: BrainServices,
  tile: IBrainTileDef,
  varName: string,
  ticks: number
): number | undefined {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);
  const page = pageResult.value!.page as BrainPageDef;
  const rule = page.children().get(0)! as BrainRuleDef;
  const numVar = mkNumVar(varName);
  for (const t of [numVar, new BrainTileOperatorDef("assign", {}, services), tile]) {
    rule.do().appendTile(t as never);
  }
  const brain: IBrain = brainDef.compile();
  brain.initialize();
  brain.startup();
  for (let i = 0; i < ticks; i++) {
    brain.think((i + 1) * 16);
  }
  const v: Value | undefined = brain.getVariable(numVar.varName);
  return v === undefined ? undefined : extractNumberValue(v);
}

const PT_CLASS = `export class Pt {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
  dbl(): number {
    return this.x * 2;
  }
}
`;

const PT_SYSTEM = `const Track = System({
  name: "track",
  state: { pt: new Pt(3) },
  think(ctx: Context) { this.pt = new Pt(this.pt.x + 1); },
});

export default Sensor({
  name: "track read",
  onExecute(ctx: Context): number { return Track.pt.x; },
});
`;

const CFG_INTERFACE = `export interface Cfg {
  speed: number;
}
`;

const CFG_SYSTEM = `const Tune = System({
  name: "tune",
  state: { cfg: { speed: 2 } as Cfg },
  think(ctx: Context) { this.cfg = { speed: this.cfg.speed + 2 }; },
});

export default Sensor({
  name: "tune read",
  onExecute(ctx: Context): number { return Tune.cfg.speed; },
});
`;

const LIM_ALIAS = `export type Lim = {
  cap: number;
};
`;

const LIM_SYSTEM = `const Fill = System({
  name: "fill",
  state: { lim: { cap: 5 } as Lim },
  think(ctx: Context) { this.lim = { cap: this.lim.cap + 1 }; },
});

export default Sensor({
  name: "fill read",
  onExecute(ctx: Context): number { return Fill.lim.cap; },
});
`;

const MODE_ENUM = `export enum Mode {
  Stop = 0,
  Go = 2,
}
`;

const MODE_SYSTEM = `const Drive = System({
  name: "drive",
  state: { mode: Mode.Stop as Mode },
  think(ctx: Context) { this.mode = Mode.Go; },
});

export default Sensor({
  name: "drive read",
  onExecute(ctx: Context): number { return Drive.mode === Mode.Go ? 7 : 1; },
});
`;

const VEC_STRUCT = `export const Vec2 = StructType({
  name: "vec2",
  fields: { x: NumberType, y: NumberType },
});
`;

const VEC_SYSTEM = `const Rove = System({
  name: "rove",
  state: { pos: Vec2({ x: 1, y: 2 }) },
  think(ctx: Context) { this.pos = Vec2({ x: this.pos.x + 1, y: this.pos.y }); },
});

export default Sensor({
  name: "rove read",
  onExecute(ctx: Context): number { return Rove.pos.x + Rove.pos.y; },
});
`;

describe("System state field types: declaration-order independence", () => {
  describe("class-typed state field", () => {
    test("class declared above the System", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${PT_CLASS}\n${PT_SYSTEM}`,
        },
        "tile.ts"
      );
      const classId = expectQualifiedOnly(services, "/tile.ts::Pt", "Pt");
      expectStateField(services, "pt", classId);
      assert.equal(runSensorThinks(services, tile, "class-above", 2), 4, "the state field reads back across thinks");
    });

    test("class declared below the System is TypeScript's own use-before-declaration error", () => {
      const services = __test__createBrainServices();
      expectTsError(services, {
        "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${PT_SYSTEM}\n${PT_CLASS}`,
      });
    });

    test("class imported into the System's module", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "defs.ts": PT_CLASS,
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\nimport { Pt } from "./defs";\n\n${PT_SYSTEM}`,
        },
        "tile.ts"
      );
      const classId = expectQualifiedOnly(services, "/defs.ts::Pt", "Pt");
      expectStateField(services, "pt", classId);
      assert.equal(runSensorThinks(services, tile, "class-import", 2), 4, "the state field reads back across thinks");
    });

    test("imported System whose state field is typed by a class declared beside it", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "lib.ts": `import { System, type Context } from "mindcraft";\n\n${PT_CLASS}\nexport ${PT_SYSTEM.replace(
            /export default Sensor[\s\S]*$/,
            ""
          )}`,
          "tile.ts": `import { Sensor, type Context } from "mindcraft";\nimport { Track } from "./lib";\n\nexport default Sensor({\n  name: "track read",\n  onExecute(ctx: Context): number { return Track.pt.x; },\n});\n`,
        },
        "tile.ts"
      );
      const classId = expectQualifiedOnly(services, "/lib.ts::Pt", "Pt");
      expectStateField(services, "pt", classId);
      assert.equal(runSensorThinks(services, tile, "class-carried", 2), 4, "the state field reads back across thinks");
    });
  });

  describe("interface-typed state field", () => {
    test("interface declared above the System", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${CFG_INTERFACE}\n${CFG_SYSTEM}`,
        },
        "tile.ts"
      );
      const ifaceId = expectQualifiedOnly(services, "/tile.ts::Cfg", "Cfg");
      expectStateField(services, "cfg", ifaceId);
      assert.equal(runSensorThinks(services, tile, "iface-above", 2), 4, "the state field reads back across thinks");
    });

    test("interface declared below the System compiles identically", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${CFG_SYSTEM}\n${CFG_INTERFACE}`,
        },
        "tile.ts"
      );
      const ifaceId = expectQualifiedOnly(services, "/tile.ts::Cfg", "Cfg");
      expectStateField(services, "cfg", ifaceId);
      assert.equal(runSensorThinks(services, tile, "iface-below", 2), 4, "the state field reads back across thinks");
    });

    test("interface imported into the System's module", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "defs.ts": CFG_INTERFACE,
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\nimport type { Cfg } from "./defs";\n\n${CFG_SYSTEM}`,
        },
        "tile.ts"
      );
      const ifaceId = expectQualifiedOnly(services, "/defs.ts::Cfg", "Cfg");
      expectStateField(services, "cfg", ifaceId);
      assert.equal(runSensorThinks(services, tile, "iface-import", 2), 4, "the state field reads back across thinks");
    });

    test("imported System whose state field is typed by an interface declared beside it", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "lib.ts": `import { System, type Context } from "mindcraft";\n\n${CFG_INTERFACE}\nexport ${CFG_SYSTEM.replace(
            /export default Sensor[\s\S]*$/,
            ""
          )}`,
          "tile.ts": `import { Sensor, type Context } from "mindcraft";\nimport { Tune } from "./lib";\n\nexport default Sensor({\n  name: "tune read",\n  onExecute(ctx: Context): number { return Tune.cfg.speed; },\n});\n`,
        },
        "tile.ts"
      );
      const ifaceId = expectQualifiedOnly(services, "/lib.ts::Cfg", "Cfg");
      expectStateField(services, "cfg", ifaceId);
      assert.equal(runSensorThinks(services, tile, "iface-carried", 2), 4, "the state field reads back across thinks");
    });
  });

  describe("type-alias-typed state field", () => {
    test("alias declared above the System", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${LIM_ALIAS}\n${LIM_SYSTEM}`,
        },
        "tile.ts"
      );
      const aliasId = expectQualifiedOnly(services, "/tile.ts::Lim", "Lim");
      expectStateField(services, "lim", aliasId);
      assert.equal(runSensorThinks(services, tile, "alias-above", 2), 6, "the state field reads back across thinks");
    });

    test("alias declared below the System compiles identically", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${LIM_SYSTEM}\n${LIM_ALIAS}`,
        },
        "tile.ts"
      );
      const aliasId = expectQualifiedOnly(services, "/tile.ts::Lim", "Lim");
      expectStateField(services, "lim", aliasId);
      assert.equal(runSensorThinks(services, tile, "alias-below", 2), 6, "the state field reads back across thinks");
    });

    test("alias imported into the System's module", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "defs.ts": LIM_ALIAS,
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\nimport type { Lim } from "./defs";\n\n${LIM_SYSTEM}`,
        },
        "tile.ts"
      );
      const aliasId = expectQualifiedOnly(services, "/defs.ts::Lim", "Lim");
      expectStateField(services, "lim", aliasId);
      assert.equal(runSensorThinks(services, tile, "alias-import", 2), 6, "the state field reads back across thinks");
    });

    test("imported System whose state field is typed by an alias declared beside it", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "lib.ts": `import { System, type Context } from "mindcraft";\n\n${LIM_ALIAS}\nexport ${LIM_SYSTEM.replace(
            /export default Sensor[\s\S]*$/,
            ""
          )}`,
          "tile.ts": `import { Sensor, type Context } from "mindcraft";\nimport { Fill } from "./lib";\n\nexport default Sensor({\n  name: "fill read",\n  onExecute(ctx: Context): number { return Fill.lim.cap; },\n});\n`,
        },
        "tile.ts"
      );
      const aliasId = expectQualifiedOnly(services, "/lib.ts::Lim", "Lim");
      expectStateField(services, "lim", aliasId);
      assert.equal(runSensorThinks(services, tile, "alias-carried", 2), 6, "the state field reads back across thinks");
    });
  });

  describe("enum-typed state field", () => {
    test("enum declared above the System", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${MODE_ENUM}\n${MODE_SYSTEM}`,
        },
        "tile.ts"
      );
      const enumId = services.runtime.types.resolveByName("/tile.ts::Mode");
      assert.ok(enumId, "expected the enum to register under its qualified name");
      expectStateField(services, "mode", enumId);
      assert.equal(runSensorThinks(services, tile, "enum-above", 2), 7, "the state field reads back across thinks");
    });

    test("enum declared below the System is TypeScript's own use-before-declaration error", () => {
      const services = __test__createBrainServices();
      expectTsError(services, {
        "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${MODE_SYSTEM}\n${MODE_ENUM}`,
      });
    });

    test("enum imported into the System's module", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "defs.ts": MODE_ENUM,
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\nimport { Mode } from "./defs";\n\n${MODE_SYSTEM}`,
        },
        "tile.ts"
      );
      const enumId = services.runtime.types.resolveByName("/defs.ts::Mode");
      assert.ok(enumId, "expected the enum to register under its qualified name");
      expectStateField(services, "mode", enumId);
      assert.equal(runSensorThinks(services, tile, "enum-import", 2), 7, "the state field reads back across thinks");
    });

    test("imported System whose state field is typed by an enum declared beside it", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "lib.ts": `import { System, type Context } from "mindcraft";\n\n${MODE_ENUM}\nexport ${MODE_SYSTEM.replace(
            /export default Sensor[\s\S]*$/,
            ""
          )}`,
          "tile.ts": `import { Sensor, type Context } from "mindcraft";\nimport { Drive } from "./lib";\nimport { Mode } from "./lib";\n\nexport default Sensor({\n  name: "drive read",\n  onExecute(ctx: Context): number { return Drive.mode === Mode.Go ? 7 : 1; },\n});\n`,
        },
        "tile.ts"
      );
      const enumId = services.runtime.types.resolveByName("/lib.ts::Mode");
      assert.ok(enumId, "expected the enum to register under its qualified name");
      expectStateField(services, "mode", enumId);
      assert.equal(runSensorThinks(services, tile, "enum-carried", 2), 7, "the state field reads back across thinks");
    });
  });

  describe("StructType-typed state field", () => {
    test("StructType declared above the System", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { NumberType, StructType, System, Sensor, type Context } from "mindcraft";\n\n${VEC_STRUCT}\n${VEC_SYSTEM}`,
        },
        "tile.ts"
      );
      const structId = services.runtime.types.resolveByName("/tile.ts::Vec2");
      assert.ok(structId, "expected the StructType to register under its declaration identity");
      expectStateField(services, "pos", structId);
      assert.equal(runSensorThinks(services, tile, "struct-above", 2), 4, "the state field reads back across thinks");
    });

    test("StructType declared below the System is TypeScript's own use-before-declaration error", () => {
      const services = __test__createBrainServices();
      expectTsError(services, {
        "tile.ts": `import { NumberType, StructType, System, Sensor, type Context } from "mindcraft";\n\n${VEC_SYSTEM}\n${VEC_STRUCT}`,
      });
    });

    test("StructType imported into the System's module", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "defs.ts": `import { NumberType, StructType } from "mindcraft";\n\n${VEC_STRUCT}`,
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\nimport { Vec2 } from "./defs";\n\n${VEC_SYSTEM}`,
        },
        "tile.ts"
      );
      const structId = services.runtime.types.resolveByName("/defs.ts::Vec2");
      assert.ok(structId, "expected the StructType to register under its declaration identity");
      expectStateField(services, "pos", structId);
      assert.equal(runSensorThinks(services, tile, "struct-import", 2), 4, "the state field reads back across thinks");
    });

    test("imported System whose state field is typed by a StructType declared beside it", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "lib.ts": `import { NumberType, StructType, System, type Context } from "mindcraft";\n\n${VEC_STRUCT}\nexport ${VEC_SYSTEM.replace(
            /export default Sensor[\s\S]*$/,
            ""
          )}`,
          "tile.ts": `import { Sensor, type Context } from "mindcraft";\nimport { Rove } from "./lib";\n\nexport default Sensor({\n  name: "rove read",\n  onExecute(ctx: Context): number { return Rove.pos.x + Rove.pos.y; },\n});\n`,
        },
        "tile.ts"
      );
      const structId = services.runtime.types.resolveByName("/lib.ts::Vec2");
      assert.ok(structId, "expected the StructType to register under its declaration identity");
      expectStateField(services, "pos", structId);
      assert.equal(runSensorThinks(services, tile, "struct-carried", 2), 4, "the state field reads back across thinks");
    });
  });

  describe("interaction sweep", () => {
    test("a self-referential class as a nullable state field links values across thinks", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";

class Chain {
  x: number;
  next?: Chain;
  constructor(x: number) {
    this.x = x;
  }
}

const Links = System({
  name: "links",
  state: { head: undefined as Chain | undefined },
  think(ctx: Context) {
    const n = new Chain(5);
    n.next = this.head;
    this.head = n;
  },
});

export default Sensor({
  name: "links read",
  onExecute(ctx: Context): number {
    const h = Links.head;
    if (h === undefined) {
      return 0;
    }
    const n = h.next;
    if (n === undefined) {
      return h.x;
    }
    return h.x + n.x + 100;
  },
});
`,
        },
        "tile.ts"
      );
      expectQualifiedOnly(services, "/tile.ts::Chain", "Chain");
      assert.equal(runSensorThinks(services, tile, "self-ref", 3), 110, "the linked state reads back across thinks");
    });

    test("a method call through a class-typed state field dispatches to the class method", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${PT_CLASS}\nconst Track = System({
  name: "track",
  state: { pt: new Pt(3) },
  think(ctx: Context) { this.pt = new Pt(this.pt.x + 1); },
});

export default Sensor({
  name: "track dbl",
  onExecute(ctx: Context): number { return Track.pt.dbl(); },
});
`,
        },
        "tile.ts"
      );
      assert.equal(runSensorThinks(services, tile, "method-call", 2), 8, "the method result reads back across thinks");
    });

    test("a nullable StructType state field starts absent and fills in", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { NumberType, StructType, System, Sensor, type StructOf, type Context } from "mindcraft";\n\n${VEC_STRUCT}\nconst Rove = System({
  name: "rove",
  state: { pos: undefined as StructOf<typeof Vec2> | undefined },
  think(ctx: Context) { this.pos = Vec2({ x: 9, y: 1 }); },
});

export default Sensor({
  name: "rove read",
  onExecute(ctx: Context): number {
    const p = Rove.pos;
    if (p === undefined) {
      return 0;
    }
    return p.x + p.y;
  },
});
`,
        },
        "tile.ts"
      );
      assert.equal(runSensorThinks(services, tile, "nullable-struct", 2), 10, "the filled state reads back");
    });

    test("a bare enum member literal as a state field carries the enum type", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${MODE_ENUM}\nconst Drive = System({
  name: "drive",
  state: { mode: Mode.Stop },
  think(ctx: Context) { this.mode = Mode.Go; },
});

export default Sensor({
  name: "drive read",
  onExecute(ctx: Context): number { return Drive.mode === Mode.Go ? 7 : 1; },
});
`,
        },
        "tile.ts"
      );
      const enumId = services.runtime.types.resolveByName("/tile.ts::Mode");
      assert.ok(enumId, "expected the enum to register under its qualified name");
      expectStateField(services, "mode", enumId);
      assert.equal(runSensorThinks(services, tile, "enum-bare", 2), 7, "the state field reads back across thinks");
    });

    test("a nullable enum state field starts absent and fills in", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${MODE_ENUM}\nconst Drive = System({
  name: "drive",
  state: { mode: undefined as Mode | undefined },
  think(ctx: Context) { this.mode = Mode.Go; },
});

export default Sensor({
  name: "drive read",
  onExecute(ctx: Context): number {
    const m = Drive.mode;
    if (m === undefined) {
      return 0;
    }
    return m === Mode.Go ? 7 : 1;
  },
});
`,
        },
        "tile.ts"
      );
      assert.equal(runSensorThinks(services, tile, "nullable-enum", 2), 7, "the filled state reads back");
    });

    test("a nullable interface state field starts absent and fills in", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${CFG_INTERFACE}\nconst Tune = System({
  name: "tune",
  state: { cfg: undefined as Cfg | undefined },
  think(ctx: Context) { this.cfg = { speed: 4 }; },
});

export default Sensor({
  name: "tune read",
  onExecute(ctx: Context): number {
    const c = Tune.cfg;
    if (c === undefined) {
      return 0;
    }
    return c.speed;
  },
});
`,
        },
        "tile.ts"
      );
      assert.equal(runSensorThinks(services, tile, "nullable-iface", 2), 4, "the filled state reads back");
    });

    test("a nullable type-alias state field starts absent and fills in", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${LIM_ALIAS}\nconst Fill = System({
  name: "fill",
  state: { lim: undefined as Lim | undefined },
  think(ctx: Context) { this.lim = { cap: 6 }; },
});

export default Sensor({
  name: "fill read",
  onExecute(ctx: Context): number {
    const l = Fill.lim;
    if (l === undefined) {
      return 0;
    }
    return l.cap;
  },
});
`,
        },
        "tile.ts"
      );
      assert.equal(runSensorThinks(services, tile, "nullable-alias", 2), 6, "the filled state reads back");
    });

    test("a co-located System may use a non-exported local enum in its state and body", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "tile.ts": `import { System, Sensor, type Context } from "mindcraft";\n\n${MODE_ENUM.replace(
            "export enum",
            "enum"
          )}\nconst Drive = System({
  name: "drive",
  state: { mode: Mode.Stop },
  think(ctx: Context) { this.mode = Mode.Go; },
});

export default Sensor({
  name: "drive read",
  onExecute(ctx: Context): number { return Drive.mode === Mode.Go ? 7 : 1; },
});
`,
        },
        "tile.ts"
      );
      assert.equal(runSensorThinks(services, tile, "private-enum", 2), 7, "the state field reads back across thinks");
    });

    test("an imported System constructing a non-exported class reports the carry diagnostic", () => {
      const services = __test__createBrainServices();
      const result = compileProject(services, {
        "lib.ts": `import { System, type Context } from "mindcraft";\n\n${PT_CLASS.replace("export class", "class")}\nexport const Track = System({
  name: "track",
  state: { pt: new Pt(3) },
  think(ctx: Context) { this.pt = new Pt(this.pt.x + 1); },
});
`,
        "tile.ts": `import { Sensor, type Context } from "mindcraft";\nimport { Track } from "./lib";\n\nexport default Sensor({\n  name: "track read",\n  onExecute(ctx: Context): number { return Track.pt.x; },\n});\n`,
      });
      assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
      const entry = result.results.get("tile.ts");
      assert.ok(entry, "expected a result for tile.ts");
      expectDiagnostic(entry.diagnostics, LoweringDiagCode.SystemModuleReferenceNotCarryable);
    });

    test("an imported System whose state field uses a non-exported StructType declared beside it", () => {
      const services = __test__createBrainServices();
      const tile = compileTile(
        services,
        {
          "lib.ts": `import { NumberType, StructType, System, type Context } from "mindcraft";\n\n${VEC_STRUCT.replace(
            "export const",
            "const"
          )}\nexport ${VEC_SYSTEM.replace(/export default Sensor[\s\S]*$/, "")}`,
          "tile.ts": `import { Sensor, type Context } from "mindcraft";\nimport { Rove } from "./lib";\n\nexport default Sensor({\n  name: "rove read",\n  onExecute(ctx: Context): number { return Rove.pos.x + Rove.pos.y; },\n});\n`,
        },
        "tile.ts"
      );
      const structId = services.runtime.types.resolveByName("/lib.ts::Vec2");
      assert.ok(structId, "expected the StructType to register under its declaration identity");
      expectStateField(services, "pos", structId);
      assert.equal(runSensorThinks(services, tile, "private-struct", 2), 4, "the state field reads back across thinks");
    });
  });
});
