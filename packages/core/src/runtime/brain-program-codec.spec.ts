import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  brainValueFromJson,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  NativeType,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";

describe("linked brain program JSON payload", () => {
  it("defines the JSON-safe linked brain payload shape", () => {
    const payload = {
      program: {
        version: 1,
        functions: [
          {
            code: [{ op: 0, a: 0 }],
            numParams: 0,
          },
        ],
        constantPools: {
          numbers: [],
          strings: [],
          values: [{ t: 0 }],
        },
        variableNames: [],
        actions: [
          {
            binding: "bytecode",
            descriptor: {
              key: "set-display-pixel",
              kind: "actuator",
              callDef: {
                callSpec: { type: "arg", tileId: "brightness" },
                argSlots: [{ slotId: 0, argSpec: { type: "arg", tileId: "brightness" } }],
              },
              isAsync: false,
            },
            entryFuncId: 0,
            numStateSlots: 0,
          },
        ],
        ruleFuncIds: [0],
        ruleAncestors: [],
      },
      ruleIndex: [{ path: "page-1/0", functionId: 0 }],
      pages: [
        {
          pageIndex: 0,
          pageId: "page-1-id",
          pageName: "page-1",
          rootRuleFuncIds: [0],
          actionCallSites: [{ actionSlot: 0, callSiteId: 1 }],
          sensors: ["button-a-pressed"],
          actuators: ["set-display-pixel"],
        },
      ],
    } satisfies LinkedBrainProgramJson;

    assert.equal(payload.program.functions[0]?.code[0]?.op, 0);
    assert.equal(payload.program.actions?.[0]?.binding, "bytecode");
    assert.equal(payload.pages[0]?.rootRuleFuncIds[0], 0);
  });
});

describe("brainValueFromJson", () => {
  it("hydrates nested runtime value containers", () => {
    const listValue = brainValueFromJson({
      t: NativeType.List,
      typeId: "list:<number>",
      v: [{ t: NativeType.Number, v: 7 }],
    });
    const mapValue = brainValueFromJson({
      t: NativeType.Map,
      typeId: "map:<string,number>",
      v: [{ key: "answer", value: { t: NativeType.String, v: "yes" } }],
    });
    const functionValue = brainValueFromJson({
      t: NativeType.Function,
      funcId: 3,
      captures: [{ t: NativeType.Boolean, v: true }],
    });

    assert.equal(listValue.t, NativeType.List);
    if (listValue.t !== NativeType.List) assert.fail("Expected list value");
    assert.equal(listValue.v.size(), 1);
    assert.deepEqual(listValue.v.get(0), { t: NativeType.Number, v: 7 });

    assert.equal(mapValue.t, NativeType.Map);
    if (mapValue.t !== NativeType.Map) assert.fail("Expected map value");
    assert.equal(mapValue.v.getString("answer")?.v, "yes");

    assert.equal(functionValue.t, NativeType.Function);
    if (functionValue.t !== NativeType.Function) assert.fail("Expected function value");
    assert.equal(functionValue.funcId, 3);
    assert.deepEqual(functionValue.captures?.get(0), { t: NativeType.Boolean, v: true });
  });
});

describe("linkedBrainProgramFromJson", () => {
  it("hydrates JSON-safe linked brain payloads into runtime containers", () => {
    const linked = linkedBrainProgramFromJson({
      program: {
        version: 1,
        functions: [
          {
            code: [{ op: 0, a: 0 }],
            numParams: 0,
            name: "rule",
          },
        ],
        constantPools: {
          numbers: [42],
          strings: ["message"],
          values: [{ t: NativeType.Void }],
        },
        variableNames: ["score"],
        actions: [
          {
            binding: "bytecode",
            descriptor: {
              key: "set-display-pixel",
              kind: "actuator",
              callDef: {
                callSpec: { type: "arg", tileId: "brightness" },
                argSlots: [{ slotId: 0, argSpec: { type: "arg", tileId: "brightness" } }],
              },
              isAsync: false,
            },
            entryFuncId: 0,
            numStateSlots: 0,
          },
        ],
        ruleFuncIds: [0],
        ruleAncestors: [{ ruleFuncId: 2, parentRuleFuncId: 0 }],
      },
      ruleIndex: [{ path: "page-1/0", functionId: 0 }],
      pages: [
        {
          pageIndex: 0,
          pageId: "page-1-id",
          pageName: "page-1",
          rootRuleFuncIds: [0],
          actionCallSites: [{ actionSlot: 0, callSiteId: 1 }],
          sensors: ["button-a-pressed"],
          actuators: ["set-display-pixel"],
        },
      ],
    });

    assert.equal(linked.program.functions.size(), 1);
    assert.equal(linked.program.functions.get(0)?.code.size(), 1);
    assert.equal(linked.program.constantPools.numbers.get(0), 42);
    assert.equal(linked.program.constantPools.strings.get(0), "message");
    assert.equal(linked.program.constantPools.values.get(0), VOID_VALUE);
    assert.equal(linked.program.variableNames.get(0), "score");
    assert.equal(linked.program.actions?.get(0)?.descriptor.callDef.argSlots.size(), 1);
    assert.equal(linked.program.ruleFuncIds?.has(0), true);
    assert.equal(linked.program.ruleAncestors?.get(2), 0);
    assert.equal(linked.ruleIndex.get("page-1/0"), 0);
    assert.equal(linked.pages.get(0)?.rootRuleFuncIds.get(0), 0);
    assert.equal(linked.pages.get(0)?.actionCallSites.get(0)?.callSiteId, 1);
    assert.equal(linked.pages.get(0)?.sensors.has("button-a-pressed"), true);
    assert.equal(linked.pages.get(0)?.actuators.has("set-display-pixel"), true);
  });
});
