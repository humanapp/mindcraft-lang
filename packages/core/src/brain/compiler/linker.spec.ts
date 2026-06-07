import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { compileBrain, linkBrainProgram } from "@mindcraft-lang/core/brain/compiler";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileActuatorDef } from "@mindcraft-lang/core/brain/tiles";
import {
  type ActionDescriptor,
  BYTECODE_VERSION,
  mkCallDef,
  mkNumberValue,
  Op,
  type UserActionArtifact,
} from "@mindcraft-lang/core/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function buildBrainWithBytecodeActuator(action: ActionDescriptor): BrainDef {
  const brainDef = new BrainDef(services);
  const pageResult = brainDef.appendNewPage();
  assert.ok(pageResult.success);

  const page = pageResult.value!.page;
  const rule = page.children().get(0)!;
  rule.do().appendTile(new BrainTileActuatorDef("test-link-bytecode-actuator", action));

  return brainDef;
}

describe("linkBrainProgram", () => {
  test("merges bytecode-backed actions into the executable program with remapped tables", () => {
    const action: ActionDescriptor = {
      key: "test-link-bytecode-action",
      kind: "actuator",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
    };
    const artifact: UserActionArtifact = {
      version: BYTECODE_VERSION,
      functions: List.from([
        {
          code: List.from([{ op: Op.CALL, a: 1, b: 0 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "user-entry",
        },
        {
          code: List.from([
            { op: Op.LOAD_VAR_SLOT, a: 0 },
            { op: Op.POP },
            { op: Op.PUSH_CONST_VAL, a: 0 },
            { op: Op.RET },
          ]),
          numParams: 0,
          numLocals: 0,
          name: "user-helper",
        },
        {
          code: List.from([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "user-activation",
        },
      ]),
      constantPools: {
        numbers: List.empty<number>(),
        strings: List.empty<string>(),
        values: List.from([mkNumberValue(42)]),
      },
      variableNames: List.from(["artifactVar"]),
      key: action.key,
      kind: action.kind,
      callDef: action.callDef,
      isAsync: false,
      numStateSlots: 2,
      entryFuncId: 0,
      activationFuncId: 2,
      revisionId: "rev-1",
    };

    const brainDef = buildBrainWithBytecodeActuator(action);
    const catalogs = List.from([services.edit.tiles, brainDef.catalog()]);
    const resolver = {
      resolveAction(candidate: ActionDescriptor) {
        if (candidate.key === action.key) {
          return {
            binding: "bytecode" as const,
            descriptor: action,
            artifact,
            metadata: {
              key: artifact.key,
              kind: artifact.kind,
              callDef: artifact.callDef,
              outputType: artifact.outputType,
            },
          };
        }
        return undefined;
      },
    };
    const compiled = compileBrain(brainDef, catalogs, services.shared.conversions, resolver).program!;
    const unlinked = {
      ...compiled,
      variableNames: List.from(["brainVar"]),
    };
    const funcOffset = unlinked.functions.size();
    const constOffset = unlinked.constantPools.values.size();
    const variableOffset = unlinked.variableNames.size();

    const linked = linkBrainProgram(unlinked, brainDef, catalogs, resolver);
    const executable = linked.program!.program;

    assert.equal(executable.actions!.size(), 1);
    assert.equal(executable.functions.size(), funcOffset + artifact.functions.size());
    assert.equal(executable.constantPools.values.size(), constOffset + artifact.constantPools.values.size());
    assert.equal(executable.variableNames.size(), variableOffset + artifact.variableNames.size());

    const linkedAction = executable.actions!.get(0)!;
    assert.equal(linkedAction.binding, "bytecode");
    if (linkedAction.binding !== "bytecode") {
      assert.fail("expected bytecode executable action");
    }

    assert.equal(linkedAction.entryFuncId, funcOffset + artifact.entryFuncId);
    assert.equal(linkedAction.activationFuncId, funcOffset + artifact.activationFuncId!);
    assert.equal(linkedAction.numStateSlots, artifact.numStateSlots);
    assert.equal(executable.variableNames.get(variableOffset), "artifactVar");

    const entryFn = executable.functions.get(linkedAction.entryFuncId)!;
    const entryCall = entryFn.code.get(0)!;
    assert.equal(entryCall.op, Op.CALL);
    assert.equal(entryCall.a, funcOffset + 1);

    const helperFn = executable.functions.get(funcOffset + 1)!;
    assert.equal(helperFn.code.get(0)!.op, Op.LOAD_VAR_SLOT);
    assert.equal(helperFn.code.get(0)!.a, variableOffset);
    assert.equal(helperFn.code.get(2)!.op, Op.PUSH_CONST_VAL);
    assert.equal(helperFn.code.get(2)!.a, constOffset);

    const activationFn = executable.functions.get(linkedAction.activationFuncId!)!;
    assert.equal(activationFn.code.get(0)!.op, Op.PUSH_CONST_VAL);
    assert.equal(activationFn.code.get(0)!.a, constOffset);
  });
});
