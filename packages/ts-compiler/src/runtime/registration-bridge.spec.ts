import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import {
  getBrainServices,
  mkActuatorTileId,
  mkParameterTileId,
  mkSensorTileId,
  registerCoreBrainComponents,
} from "@mindcraft-lang/core/brain";
import { compileUserTile } from "../compiler/compile.js";
import { registerUserTile } from "./registration-bridge.js";

function compileProgram(source: string) {
  const result = compileUserTile(source);
  assert.deepStrictEqual(result.diagnostics, [], `Compile errors: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);
  return result.program!;
}

describe("registration-bridge", () => {
  before(() => {
    registerCoreBrainComponents();
  });

  test("registers a bytecode-backed sensor action without touching FunctionRegistry", () => {
    const program = compileProgram(`
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "phase6-reg-sensor",
  output: "number",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`);

    registerUserTile(program);

    const { actions, functions, tiles } = getBrainServices();
    const action = actions.getByKey(program.key);
    assert.ok(action, "bytecode action should be registered");
    assert.equal(action!.binding, "bytecode");
    if (action!.binding === "bytecode") {
      assert.equal(action!.artifact, program);
      assert.equal(action!.artifact.entryFuncId, program.entryFuncId);
      assert.equal(action!.artifact.activationFuncId, program.activationFuncId);
    }

    assert.equal(functions.get(program.key), undefined, "FunctionRegistry should not receive a wrapper entry");
    assert.ok(tiles.has(mkSensorTileId(program.key)), "sensor tile metadata should be registered");
  });

  test("registers actuator metadata plus named and anonymous parameter tiles", () => {
    const program = compileProgram(`
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "phase6-reg-actuator",
  params: {
    distance: { type: "number" },
    label: { type: "string" },
    target: { type: "number", anonymous: true },
  },
  onExecute(ctx: Context, params: { distance: number; label: string; target: number }): void {
  },
});
`);

    registerUserTile(program);

    const { tiles } = getBrainServices();
    assert.ok(tiles.has(mkActuatorTileId(program.key)), "actuator tile metadata should be registered");
    assert.ok(tiles.has(mkParameterTileId("user.phase6-reg-actuator.distance")));
    assert.ok(tiles.has(mkParameterTileId("user.phase6-reg-actuator.label")));
    assert.ok(tiles.has(mkParameterTileId("anon.number")));
  });

  test("throws a plain error when a parameter type cannot be resolved", () => {
    const program = compileProgram(`
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "phase6-reg-unknown-param",
  params: {
    target: { type: "number" },
  },
  onExecute(ctx: Context, params: { target: number }): void {
  },
});
`);

    program.params[0]!.type = "vector2";

    assert.throws(
      () => registerUserTile(program),
      /Unknown parameter type "vector2" for "user\.actuator\.phase6-reg-unknown-param"/
    );
  });

  test("preserves artifact-local activation ids for direct core linking", () => {
    const program = compileProgram(`
import { Sensor, type Context } from "mindcraft";

let counter = 0;

export default Sensor({
  name: "phase6-activation-sensor",
  output: "number",
  onExecute(ctx: Context): number {
    counter += 1;
    return counter;
  },
  onPageEntered(ctx: Context): void {
    counter = 10;
  },
});
`);

    assert.ok(program.activationFuncId !== undefined, "expected activationFuncId for stateful action");

    registerUserTile(program);

    const action = getBrainServices().actions.getByKey(program.key);
    assert.ok(action, "bytecode action should be registered");
    assert.equal(action!.binding, "bytecode");
    if (action!.binding === "bytecode") {
      assert.equal(action!.artifact.entryFuncId, program.entryFuncId);
      assert.equal(action!.artifact.activationFuncId, program.activationFuncId);
      assert.equal(action!.artifact.revisionId, program.revisionId);
    }
  });
});
