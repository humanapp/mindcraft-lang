import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import {
  type ActionDescriptor,
  BYTECODE_VERSION,
  getBrainServices,
  mkCallDef,
  mkNumberValue,
  Op,
  registerCoreBrainComponents,
  type UserActionArtifact,
} from "@mindcraft-lang/core/brain";
import { compileBrain } from "@mindcraft-lang/core/brain/compiler";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { linkBrainProgram } from "@mindcraft-lang/core/brain/runtime";
import { BrainTileActuatorDef } from "@mindcraft-lang/core/brain/tiles";

before(() => {
  registerCoreBrainComponents();
});

function buildBrainWithBytecodeActuator(action: ActionDescriptor): BrainDef {
  const brainDef = new BrainDef();
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
          code: List.from([{ op: Op.LOAD_VAR, a: 0 }, { op: Op.POP }, { op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "user-helper",
        },
        {
          code: List.from([{ op: Op.PUSH_CONST, a: 0 }, { op: Op.RET }]),
          numParams: 0,
          numLocals: 0,
          name: "user-activation",
        },
      ]),
      constants: List.from([mkNumberValue(42)]),
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
    const catalogs = List.from([getBrainServices().tiles, brainDef.catalog()]);
    const compiled = compileBrain(brainDef, catalogs);
    const unlinked = {
      ...compiled,
      variableNames: List.from(["brainVar"]),
    };
    const funcOffset = unlinked.functions.size();
    const constOffset = unlinked.constants.size();
    const variableOffset = unlinked.variableNames.size();

    const executable = linkBrainProgram(unlinked, brainDef, catalogs, {
      resolveAction(candidate) {
        if (candidate.key === action.key) {
          return {
            binding: "bytecode" as const,
            descriptor: action,
            artifact,
          };
        }
        return undefined;
      },
    });

    assert.equal(executable.actions.size(), 1);
    assert.equal(executable.functions.size(), funcOffset + artifact.functions.size());
    assert.equal(executable.constants.size(), constOffset + artifact.constants.size());
    assert.equal(executable.variableNames.size(), variableOffset + artifact.variableNames.size());

    const linkedAction = executable.actions.get(0)!;
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
    assert.equal(helperFn.code.get(0)!.op, Op.LOAD_VAR);
    assert.equal(helperFn.code.get(0)!.a, variableOffset);
    assert.equal(helperFn.code.get(2)!.op, Op.PUSH_CONST);
    assert.equal(helperFn.code.get(2)!.a, constOffset);

    const activationFn = executable.functions.get(linkedAction.activationFuncId!)!;
    assert.equal(activationFn.code.get(0)!.op, Op.PUSH_CONST);
    assert.equal(activationFn.code.get(0)!.a, constOffset);
  });
});
