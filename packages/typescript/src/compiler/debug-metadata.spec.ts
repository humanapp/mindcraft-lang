import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import {
  type BrainProgram,
  BYTECODE_VERSION,
  type FunctionBytecode,
  mkNumberValue,
  Op,
  type PageMetadata,
  registerCoreBrainComponents,
  type Value,
} from "@mindcraft-lang/core/brain";
import { linkUserPrograms } from "../linker/linker.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";
import { UserTileProject } from "./project.js";

function compileProject(files: Record<string, string>) {
  const ambientSource = buildAmbientDeclarations();
  const project = new UserTileProject({ ambientSource });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

function mkEmptyBrainProgram(): BrainProgram {
  const emptyPage: PageMetadata = {
    pageIndex: 0,
    pageId: "page-0",
    pageName: "Page 0",
    rootRuleFuncIds: List.empty(),
    actionCallSites: List.empty(),
    sensors: new UniqueSet<string>(),
    actuators: new UniqueSet<string>(),
  };
  return {
    version: BYTECODE_VERSION,
    functions: List.empty(),
    constants: List.empty(),
    variableNames: List.empty(),
    entryPoint: 0,
    ruleIndex: Dict.empty(),
    actionRefs: List.empty(),
    pages: List.from([emptyPage]),
  };
}

describe("debug metadata assembly", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("compiled program has debugMetadata with correct file and function counts", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);
    assert.ok(result.program!.debugMetadata);

    const dm = result.program!.debugMetadata!;
    assert.ok(dm.files.length >= 1, "expected at least 1 file");
    assert.equal(dm.files[0].path, "user-code.ts");
    assert.ok(dm.files[0].sourceHash.length > 0, "expected non-empty sourceHash");

    const funcCount = result.program!.functions.size();
    assert.equal(dm.functions.length, funcCount, "function count in debugMetadata should match program functions");
  });

  test("compiledFuncId matches index in program functions", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(): number { return 42; }

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return helper();
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    for (const fn of dm.functions) {
      assert.ok(
        fn.compiledFuncId >= 0 && fn.compiledFuncId < result.program!.functions.size(),
        `compiledFuncId ${fn.compiledFuncId} out of range [0, ${result.program!.functions.size()})`
      );
    }

    const ids = dm.functions.map((f) => f.compiledFuncId);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, ids.length, "compiledFuncId values should be unique");
  });

  test("generated functions have isGenerated true", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    counter++;
    return counter;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    const initFn = dm.functions.find((f) => f.debugFunctionId.endsWith("/<init>"));
    assert.ok(initFn, "expected module-init function");
    assert.equal(initFn!.isGenerated, true, "module-init should be generated");

    const wrapperFn = dm.functions.find((f) => f.debugFunctionId.endsWith("/<onPageEntered-wrapper>"));
    assert.ok(wrapperFn, "expected onPageEntered wrapper function");
    assert.equal(wrapperFn!.isGenerated, true, "onPageEntered-wrapper should be generated");
  });

  test("user-authored functions have isGenerated false", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(): number { return 42; }

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return helper();
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    const onExec = dm.functions.find((f) => f.prettyName === "test.onExecute");
    assert.ok(onExec, "expected onExecute function");
    assert.equal(onExec!.isGenerated, false);

    const helperFn = dm.functions.find((f) => f.prettyName === "helper");
    assert.ok(helperFn, "expected helper function");
    assert.equal(helperFn!.isGenerated, false);
  });

  test("class methods and constructors have distinct debugFunctionId values", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  distance(): number {
    return this.x + this.y;
  }
}

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const p = new Point(1, 2);
    return p.distance();
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    const ctorFn = dm.functions.find((f) => f.debugFunctionId.includes("Point.constructor"));
    assert.ok(ctorFn, "expected Point constructor");
    assert.equal(ctorFn!.isGenerated, false);

    const methodFn = dm.functions.find((f) => f.debugFunctionId.includes("Point.distance"));
    assert.ok(methodFn, "expected Point.distance method");
    assert.equal(methodFn!.isGenerated, false);

    assert.notEqual(
      ctorFn!.debugFunctionId,
      methodFn!.debugFunctionId,
      "constructor and method should have different debugFunctionIds"
    );
  });

  test("multi-file project has multiple DebugFileInfo entries", () => {
    const result = compileProject({
      "helpers/math.ts": `
export function add(a: number, b: number): number {
  return a + b;
}
`,
      "sensors/calc.ts": `
import { Sensor, type Context } from "mindcraft";
import { add } from "../helpers/math";

export default Sensor({
  name: "calc",
  output: "number",
  onExecute(ctx: Context): number {
    return add(1, 2);
  },
});
`,
    });

    assert.equal(result.tsErrors.size, 0);
    const entry = result.results.get("sensors/calc.ts");
    assert.ok(entry);
    assert.deepStrictEqual(entry.diagnostics, []);
    assert.ok(entry.program);

    const dm = entry.program!.debugMetadata!;
    assert.ok(dm.files.length >= 2, `expected at least 2 files, got ${dm.files.length}`);

    const paths = dm.files.map((f) => f.path);
    assert.ok(
      paths.some((p) => p.includes("math.ts")),
      "expected helpers/math.ts in files"
    );
    assert.ok(
      paths.some((p) => p.includes("calc.ts")),
      "expected sensors/calc.ts in files"
    );
  });

  test("linked program debug metadata has correctly offset compiledFuncId values", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program);
    assert.ok(result.program!.debugMetadata);

    const brainProgram = mkEmptyBrainProgram();
    const stubFn: FunctionBytecode = {
      code: List.from([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }]),
      numParams: 0,
      numLocals: 0,
      name: "brain-stub",
    };
    const brainWithStub: BrainProgram = {
      ...brainProgram,
      functions: List.from([stubFn, stubFn, stubFn]),
      constants: List.from([mkNumberValue(0) as Value]),
    };

    const linkResult = linkUserPrograms(brainWithStub, [result.program!]);
    assert.equal(linkResult.userLinks.length, 1);

    const link = linkResult.userLinks[0];
    assert.ok(link.linkedDebugMetadata);

    const funcOffset = 3;
    const originalDm = result.program!.debugMetadata!;
    const linkedDm = link.linkedDebugMetadata!;

    assert.equal(linkedDm.functions.length, originalDm.functions.length);
    for (let i = 0; i < linkedDm.functions.length; i++) {
      assert.equal(
        linkedDm.functions[i].compiledFuncId,
        originalDm.functions[i].compiledFuncId + funcOffset,
        `function ${i}: expected compiledFuncId ${originalDm.functions[i].compiledFuncId + funcOffset} but got ${linkedDm.functions[i].compiledFuncId}`
      );
    }

    assert.deepStrictEqual(linkedDm.files, originalDm.files, "files should be unchanged after linking");
  });

  test("closure functions have parentName in debugFunctionId", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const arr = [3, 1, 2];
    const mapped = arr.map((x: number) => x * 2);
    return mapped[0];
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    const closureFns = dm.functions.filter((f) => f.debugFunctionId.includes("<closure#"));
    assert.ok(closureFns.length > 0, "expected at least one closure function");

    for (const fn of closureFns) {
      assert.equal(fn.isGenerated, false, "closures should not be generated");
      assert.ok(
        fn.debugFunctionId.includes("test.onExecute/"),
        `closure debugFunctionId should reference parent: ${fn.debugFunctionId}`
      );
    }
  });

  test("debugFunctionId values are unique across all functions", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(): number { return 1; }

let counter = 0;

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    const fn = (x: number) => x + 1;
    return helper() + fn(counter);
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    const ids = dm.functions.map((f) => f.debugFunctionId);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, ids.length, `debugFunctionId values should be unique: ${JSON.stringify(ids)}`);
  });

  test("programRevisionId is populated", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.program!.programRevisionId);
    assert.ok(result.program!.programRevisionId.length > 0);
  });

  test("function sourceSpan is populated for user functions", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(): number { return 42; }

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return helper();
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    const helperFn = dm.functions.find((f) => f.prettyName === "helper");
    assert.ok(helperFn);
    assert.ok(helperFn!.sourceSpan.startLine > 0, "helper sourceSpan should have a real start line");
    assert.ok(helperFn!.sourceSpan.endLine >= helperFn!.sourceSpan.startLine);

    const onExec = dm.functions.find((f) => f.prettyName === "test.onExecute");
    assert.ok(onExec);
    assert.ok(onExec!.sourceSpan.startLine > 0, "onExecute sourceSpan should have a real start line");
  });

  test("callSites and suspendSites arrays are present on all functions", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";

function helper(): number { return 42; }

export default Sensor({
  name: "test",
  output: "number",
  onExecute(ctx: Context): number {
    return helper();
  },
});
`;
    const result = compileUserTile(source);
    assert.deepStrictEqual(result.diagnostics, []);
    const dm = result.program!.debugMetadata!;

    for (const fn of dm.functions) {
      assert.ok(Array.isArray(fn.callSites), `${fn.prettyName}: callSites should be an array`);
      assert.ok(Array.isArray(fn.suspendSites), `${fn.prettyName}: suspendSites should be an array`);
    }
  });
});
