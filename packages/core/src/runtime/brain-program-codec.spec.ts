import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Dict, List } from "@mindcraft-lang/core";
import {
  brainValueFromJson,
  brainValueToJson,
  ErrorCode,
  FALSE_VALUE,
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  linkedBrainProgramToJson,
  mkCallDef,
  mkClosedStructValue,
  mkFunctionValue,
  mkListValue,
  mkNumberValue,
  mkStringValue,
  NativeType,
  NIL_VALUE,
  TRUE_VALUE,
  UNKNOWN_VALUE,
  type Value,
  ValueDict,
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
            entryFuncId: 0,
          },
        ],
        ruleFuncIds: [0],
        ruleAncestors: [],
      },
      pages: [
        {
          pageIndex: 0,
          pageId: "page-1-id",
          pageName: "page-1",
          rootRuleFuncIds: [0],
          actionCallSites: [{ binding: "bytecode", actionSlot: 0, callSiteId: 1 }],
        },
      ],
    } satisfies LinkedBrainProgramJson;

    assert.equal(payload.program.functions[0]?.code[0]?.op, 0);
    assert.equal(payload.program.actions?.[0]?.entryFuncId, 0);
    assert.equal(payload.pages[0]?.rootRuleFuncIds[0], 0);
  });
});

describe("brainValueToJson", () => {
  it("round-trips every runtime value kind through JSON", () => {
    const values: Value[] = [
      UNKNOWN_VALUE,
      VOID_VALUE,
      NIL_VALUE,
      TRUE_VALUE,
      FALSE_VALUE,
      mkNumberValue(42),
      mkStringValue("hi"),
      { t: NativeType.Enum, typeId: "Color", v: "Red" },
      mkListValue("list:<number>", List.from([mkNumberValue(1), mkNumberValue(2)])),
      { t: NativeType.Map, typeId: "map:<string,string>", v: new ValueDict([["k", mkStringValue("v")]]) },
      mkClosedStructValue("Point", List.from([mkNumberValue(1), mkNumberValue(2)])),
      mkFunctionValue(3, List.from([TRUE_VALUE])),
      mkFunctionValue(4),
      { t: "handle", id: 7 },
      { t: "err", e: { code: ErrorCode.HostError, message: "boom" } },
      {
        t: "err",
        e: {
          code: ErrorCode.Timeout,
          message: "late",
          detail: { reason: "x" },
          site: { funcId: 1, pc: 2 },
          stackTrace: List.from(["a", "b"]),
        },
      },
    ];

    for (const value of values) {
      const json = brainValueToJson(value);
      assert.deepEqual(brainValueToJson(brainValueFromJson(json)), json);
    }
  });
});

describe("linkedBrainProgramToJson", () => {
  it("round-trips a lean linked program payload with bytecode actions", () => {
    const payload = {
      program: {
        version: 1,
        functions: [{ code: [{ op: 0, a: 0 }], numParams: 0 }],
        constantPools: {
          numbers: [42],
          strings: ["message"],
          values: [{ t: NativeType.Void }],
        },
        variableNames: ["score"],
        actions: [
          {
            entryFuncId: 0,
          },
        ],
        ruleFuncIds: [0],
        ruleAncestors: [{ ruleFuncId: 2, parentRuleFuncId: 0 }],
      },
      pages: [
        {
          pageIndex: 0,
          pageId: "page-1-id",
          pageName: "page-1",
          rootRuleFuncIds: [0],
          actionCallSites: [{ binding: "bytecode", actionSlot: 0, callSiteId: 1 }],
        },
      ],
    } satisfies LinkedBrainProgramJson;

    assert.deepEqual(linkedBrainProgramToJson(linkedBrainProgramFromJson(payload)), payload);
  });

  it("round-trips a host call site and a HOST_ACTION_CALL instruction", () => {
    const payload = {
      program: {
        version: 1,
        functions: [{ code: [{ op: 44, a: 3, b: 0, c: 7 }], numParams: 0 }],
        constantPools: { numbers: [], strings: [], values: [] },
        variableNames: [],
        actions: [],
        ruleFuncIds: [0],
        ruleAncestors: [],
      },
      pages: [
        {
          pageIndex: 0,
          pageId: "page-1-id",
          pageName: "page-1",
          rootRuleFuncIds: [0],
          actionCallSites: [{ binding: "host", actionId: 3, callSiteId: 7 }],
        },
      ],
    } satisfies LinkedBrainProgramJson;

    assert.deepEqual(linkedBrainProgramToJson(linkedBrainProgramFromJson(payload)), payload);
  });
});

describe("linkedBrainProgramToJson lean payload", () => {
  it("drops non-execution-essential fields from the serialized payload", () => {
    const program: LinkedBrainProgram = {
      program: {
        version: 1,
        functions: List.from([{ code: List.empty(), numParams: 0, name: "rule", maxStackDepth: 3 }]),
        constantPools: { numbers: List.empty(), strings: List.empty(), values: List.empty() },
        variableNames: List.empty(),
        actions: List.from([
          {
            binding: "bytecode",
            descriptor: {
              key: "set-display-pixel",
              kind: "actuator",
              callDef: mkCallDef({ type: "bag", items: [] }),
              isAsync: false,
            },
            entryFuncId: 0,
            numStateSlots: 4,
          },
        ]),
      },
      ruleIndex: new Dict([["page-1/0", 0]]),
      pages: List.from([
        {
          pageIndex: 0,
          pageId: "page-1-id",
          pageName: "page-1",
          rootRuleFuncIds: List.from([0]),
          actionCallSites: List.empty(),
        },
      ]),
    };

    const json = linkedBrainProgramToJson(program);

    const fn = json.program.functions[0] as unknown as Record<string, unknown>;
    assert.equal(fn.name, undefined);
    assert.equal(fn.maxStackDepth, undefined);

    const action = json.program.actions?.[0] as unknown as Record<string, unknown>;
    assert.equal(action?.entryFuncId, 0);
    // The lean format records only function ids; binding/key/isAsync are not serialized.
    assert.equal(action?.binding, undefined);
    assert.equal(action?.key, undefined);
    assert.equal(action?.isAsync, undefined);
    assert.equal(action?.descriptor, undefined);
    assert.equal(action?.numStateSlots, undefined);

    assert.equal((json as unknown as Record<string, unknown>).ruleIndex, undefined);
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
            entryFuncId: 0,
          },
        ],
        ruleFuncIds: [0],
        ruleAncestors: [{ ruleFuncId: 2, parentRuleFuncId: 0 }],
      },
      pages: [
        {
          pageIndex: 0,
          pageId: "page-1-id",
          pageName: "page-1",
          rootRuleFuncIds: [0],
          actionCallSites: [{ binding: "bytecode", actionSlot: 0, callSiteId: 1 }],
        },
      ],
    });

    assert.equal(linked.program.functions.size(), 1);
    assert.equal(linked.program.functions.get(0)?.code.size(), 1);
    assert.equal(linked.program.functions.get(0)?.name, undefined);
    assert.equal(linked.program.constantPools.numbers.get(0), 42);
    assert.equal(linked.program.constantPools.strings.get(0), "message");
    assert.equal(linked.program.constantPools.values.get(0), VOID_VALUE);
    assert.equal(linked.program.variableNames.get(0), "score");

    const action = linked.program.actions?.get(0);
    assert.equal(action?.binding, "bytecode");
    if (action?.binding !== "bytecode") assert.fail("expected a bytecode action");
    // key/isAsync are not serialized in the lean format; deserialized actions carry placeholders.
    assert.equal(action.descriptor.key, "");
    assert.equal(action.descriptor.isAsync, false);
    assert.equal(action.descriptor.callDef.argSlots.size(), 0);
    assert.equal(action.entryFuncId, 0);
    assert.equal(action.numStateSlots, 0);

    assert.equal(linked.program.ruleFuncIds?.has(0), true);
    assert.equal(linked.program.ruleAncestors?.get(2), 0);
    assert.equal(linked.ruleIndex.size(), 0);
    assert.equal(linked.pages.get(0)?.rootRuleFuncIds.get(0), 0);
    assert.equal(linked.pages.get(0)?.actionCallSites.get(0)?.callSiteId, 1);
  });
});
