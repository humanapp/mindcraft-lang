import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LinkedBrainProgramJson } from "./brain-program-codec";

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
