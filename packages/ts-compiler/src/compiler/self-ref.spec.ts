import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { ExecutionContext, Scheduler } from "@mindcraft-lang/core/brain";
import {
  type BrainServices,
  HandleTable,
  NativeType,
  type NumberValue,
  runtime,
  type StructTypeDef,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { buildAmbientDeclarations } from "./ambient.js";
import { compileUserTile } from "./compile.js";

let services: BrainServices;

function mkCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    brain: undefined as never,
    getVariable: () => undefined,
    setVariable: () => {},
    clearVariable: () => {},
    time: 0,
    dt: 0,
    currentTick: 0,
    ...overrides,
  };
}

function mkScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

describe("self-referential and mutually recursive types", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("self-referential interface (TreeNode) registers correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface TreeNode {
  value: number;
  left?: TreeNode;
  right?: TreeNode;
}

export default Sensor({
  name: "selfref-tree",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const typeId = registry.resolveByName("/user-code.ts::TreeNode");
    assert.ok(typeId, "TreeNode struct type should be registered");
    const def = registry.get(typeId!) as StructTypeDef;
    assert.equal(def.coreType, NativeType.Struct);

    const fieldNames: string[] = [];
    def.fields.forEach((f) => {
      fieldNames.push(f.name);
    });
    assert.ok(fieldNames.includes("value"), "should have field value");
    assert.ok(fieldNames.includes("left"), "should have field left");
    assert.ok(fieldNames.includes("right"), "should have field right");
  });

  test("self-referential interface compiles and executes", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface TreeNode {
  value: number;
  left?: TreeNode;
  right?: TreeNode;
}

export default Sensor({
  name: "selfref-exec",
  output: "number",
  onExecute(ctx: Context): number {
    const leaf: TreeNode = { value: 10 };
    const root: TreeNode = { value: 1, left: leaf };
    return root.value + root.left!.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 11);
    }
  });

  test("mutually recursive interfaces register correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface NodeA {
  value: number;
  partner?: NodeB;
}

interface NodeB {
  label: string;
  back?: NodeA;
}

export default Sensor({
  name: "mutual-rec",
  output: "number",
  onExecute(ctx: Context): number {
    return 0;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);

    const registry = services.types;
    const nodeAId = registry.resolveByName("/user-code.ts::NodeA");
    const nodeBId = registry.resolveByName("/user-code.ts::NodeB");
    assert.ok(nodeAId, "NodeA should be registered");
    assert.ok(nodeBId, "NodeB should be registered");

    const nodeADef = registry.get(nodeAId!) as StructTypeDef;
    const nodeBDef = registry.get(nodeBId!) as StructTypeDef;

    const nodeAFieldNames: string[] = [];
    nodeADef.fields.forEach((f) => {
      nodeAFieldNames.push(f.name);
    });
    assert.ok(nodeAFieldNames.includes("value"));
    assert.ok(nodeAFieldNames.includes("partner"));

    const nodeBFieldNames: string[] = [];
    nodeBDef.fields.forEach((f) => {
      nodeBFieldNames.push(f.name);
    });
    assert.ok(nodeBFieldNames.includes("label"));
    assert.ok(nodeBFieldNames.includes("back"));
  });

  test("mutually recursive interfaces compile and execute", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface NodeA {
  value: number;
  partner?: NodeB;
}

interface NodeB {
  label: string;
  back?: NodeA;
}

export default Sensor({
  name: "mutual-exec",
  output: "number",
  onExecute(ctx: Context): number {
    const a: NodeA = { value: 42 };
    const b: NodeB = { label: "hello", back: a };
    return b.back!.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 42);
    }
  });

  test("self-referential type alias registers correctly", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

type LinkedNode = {
  value: number;
  next?: LinkedNode;
};

export default Sensor({
  name: "selfref-talias",
  output: "number",
  onExecute(ctx: Context): number {
    const n1: LinkedNode = { value: 10 };
    const n2: LinkedNode = { value: 20, next: n1 };
    return n2.value + n2.next!.value;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 30);
    }
  });

  test("cross-kind mutual recursion (interface + type alias)", () => {
    const ambientSource = buildAmbientDeclarations(services.types);
    const source = `
import { Sensor, type Context } from "mindcraft";

interface Parent {
  name: string;
  child?: Child;
}

type Child = {
  age: number;
  parent?: Parent;
};

export default Sensor({
  name: "cross-kind-rec",
  output: "number",
  onExecute(ctx: Context): number {
    const p: Parent = { name: "Alice" };
    const c: Child = { age: 5, parent: p };
    return c.age;
  },
});
`;
    const result = compileUserTile(source, { ambientSource, services });
    assert.deepStrictEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.program);

    const prog = result.program!;
    const handles = new HandleTable(100);
    const vm = new runtime.VM(services, prog, handles);

    const fiber = vm.spawnFiber(1, 0, List.empty<Value>(), mkCtx());
    fiber.instrBudget = 2000;

    const runResult = vm.runFiber(fiber, mkScheduler());
    assert.equal(runResult.status, VmStatus.DONE);
    if (runResult.status === VmStatus.DONE) {
      assert.ok(runResult.result);
      assert.equal(runResult.result!.t, NativeType.Number);
      assert.equal((runResult.result as NumberValue).v, 5);
    }
  });
});
