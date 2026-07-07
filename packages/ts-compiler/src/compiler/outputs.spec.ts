import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { CoreTypeIds, mkOutputTileId, mkOutputVarKey } from "@mindcraft-lang/core/runtime";
import { buildCompiledActionBundle } from "../runtime/action-bundle.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { expectDiagnostic } from "../testsupport/diag-coverage.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { DescriptorDiagCode, LoweringDiagCode } from "./diag-codes.js";
import { UserTileProject } from "./project.js";

let services: BrainServices;

function compileProject(files: Record<string, string>) {
  const ambientSource = buildAmbientDeclarations(services.runtime.types);
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: [{ path: "ambient.d.ts", content: ambientSource }],
    services,
  });
  project.setFiles(new Map(Object.entries(files)));
  return project.compileAll();
}

/** A sensor that declares the given `outputs` array text and writes them in `onExecute`. */
function sensorSource(id: string, name: string, outputs: string, body: string): string {
  return `
import { Sensor, setOutput, type Context } from "mindcraft";

export default Sensor({
  id: "${id}",
  name: "${name}",
  outputs: ${outputs},
  onExecute(ctx: Context): number {
${body}
    return 1;
  },
});
`;
}

describe("sensor output extraction", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("a valid outputs array is carried onto the compiled program", () => {
    const result = compileProject({
      "rx.ts": sensorSource(
        "snrx",
        "rx",
        `[{ name: "value", type: "string" }, { name: "rssi", type: "number", label: "signal strength" }]`,
        `    setOutput(ctx, "value", "hi");\n    setOutput(ctx, "rssi", 7);`
      ),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.deepEqual(entry.program.outputs, [
      { name: "value", type: "string", label: undefined, icon: undefined, docs: undefined, tags: undefined },
      { name: "rssi", type: "number", label: "signal strength", icon: undefined, docs: undefined, tags: undefined },
    ]);
  });

  test("a non-array outputs value is diagnosed", () => {
    const result = compileProject({
      "bad.ts": sensorSource("snbad", "bad", `"nope" as any`, ``),
    });
    const entry = result.results.get("bad.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.some((d) => d.code === DescriptorDiagCode.OutputsMustBeArrayLiteral));
  });

  test("a non-string-literal output type is diagnosed", () => {
    const result = compileProject({
      "bad.ts": sensorSource("snbad", "bad", `[{ name: "value", type: ("num" + "ber") as any }]`, ``),
    });
    const entry = result.results.get("bad.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.some((d) => d.code === DescriptorDiagCode.OutputTypeMustBeStringLiteral));
  });

  test("a non-string-literal output name is diagnosed", () => {
    const result = compileProject({
      "bad.ts": sensorSource("snbad", "bad", `[{ name: ("v" + "1") as any, type: "number" }]`, ``),
    });
    const entry = result.results.get("bad.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.some((d) => d.code === DescriptorDiagCode.OutputNameMustBeStringLiteral));
  });

  test("two outputs sharing a name on one sensor are diagnosed", () => {
    const result = compileProject({
      "bad.ts": sensorSource(
        "snbad",
        "bad",
        `[{ name: "value", type: "number" }, { name: "value", type: "string" }]`,
        ``
      ),
    });
    const entry = result.results.get("bad.ts");
    assert.ok(entry);
    assert.ok(entry.diagnostics.some((d) => d.code === DescriptorDiagCode.DuplicateOutputName));
  });
});

describe("setOutput lowering", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("setOutput to a declared output compiles without diagnostics", () => {
    const result = compileProject({
      "rx.ts": sensorSource("snrx", "rx", `[{ name: "value", type: "string" }]`, `    setOutput(ctx, "value", "hi");`),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry?.program, "expected a compiled program");
    assert.deepEqual(entry.diagnostics, [], JSON.stringify(entry.diagnostics));
  });

  test("setOutput naming an undeclared output is diagnosed", () => {
    const result = compileProject({
      "rx.ts": sensorSource(
        "snrx",
        "rx",
        `[{ name: "value", type: "string" }]`,
        `    setOutput(ctx, "missing", "hi");`
      ),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry);
    expectDiagnostic(entry.diagnostics, LoweringDiagCode.SetOutputUnknownOutput);
  });

  test("setOutput with a non-string-literal name is diagnosed", () => {
    const result = compileProject({
      "rx.ts": sensorSource(
        "snrx",
        "rx",
        `[{ name: "value", type: "string" }]`,
        `    const k = "value";\n    setOutput(ctx, k, "hi");`
      ),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry);
    expectDiagnostic(entry.diagnostics, LoweringDiagCode.SetOutputNameNotStringLiteral);
  });

  test("setOutput in an actuator (no outputs in scope) is diagnosed", () => {
    const result = compileProject({
      "act.ts": `
import { Actuator, setOutput, type Context } from "mindcraft";

export default Actuator({
  id: "acbad",
  name: "bad",
  onExecute(ctx: Context): void {
    setOutput(ctx, "value", 1);
  },
});
`,
    });
    const entry = result.results.get("act.ts");
    assert.ok(entry);
    expectDiagnostic(entry.diagnostics, LoweringDiagCode.SetOutputOutsideSensor);
  });

  test("an output whose declared type does not resolve is diagnosed, not silently skipped", () => {
    const result = compileProject({
      "rx.ts": sensorSource("snrx", "rx", `[{ name: "it", type: "Bogus" }]`, ``),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry);
    expectDiagnostic(entry.diagnostics, LoweringDiagCode.OutputTypeUnresolvable);
  });

  test("setOutput to a declared-but-unresolvable output is not misreported as undeclared", () => {
    const result = compileProject({
      "rx.ts": sensorSource("snrx", "rx", `[{ name: "it", type: "Bogus" }]`, `    setOutput(ctx, "it", 1);`),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry);
    expectDiagnostic(entry.diagnostics, LoweringDiagCode.OutputTypeUnresolvable);
    assert.ok(!entry.diagnostics.some((d) => d.code === LoweringDiagCode.SetOutputUnknownOutput));
  });

  test("a setOutput value incompatible with the declared output type is diagnosed", () => {
    const result = compileProject({
      "rx.ts": sensorSource(
        "snrx",
        "rx",
        `[{ name: "rssi", type: "number" }]`,
        `    setOutput(ctx, "rssi", [1, 2, 3]);`
      ),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry);
    expectDiagnostic(entry.diagnostics, LoweringDiagCode.SetOutputValueTypeMismatch);
  });

  test("a setOutput value convertible to the declared type compiles (coerced)", () => {
    const result = compileProject({
      "rx.ts": sensorSource("snrx", "rx", `[{ name: "label", type: "string" }]`, `    setOutput(ctx, "label", 42);`),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry?.program);
    assert.deepEqual(entry.diagnostics, [], JSON.stringify(entry.diagnostics));
  });

  test("clearing an output with null is allowed", () => {
    const result = compileProject({
      "rx.ts": sensorSource("snrx", "rx", `[{ name: "value", type: "string" }]`, `    setOutput(ctx, "value", null);`),
    });
    const entry = result.results.get("rx.ts");
    assert.ok(entry?.program);
    assert.deepEqual(entry.diagnostics, [], JSON.stringify(entry.diagnostics));
  });
});

describe("derived output tiles", () => {
  before(() => {
    services = __test__createBrainServices();
  });

  test("a sensor with two outputs yields two inline output tiles the sensor gates", () => {
    const result = compileProject({
      "rx.ts": sensorSource(
        "snrx",
        "rx",
        `[{ name: "value", type: "string" }, { name: "rssi", type: "number" }]`,
        `    setOutput(ctx, "value", "hi");\n    setOutput(ctx, "rssi", 7);`
      ),
    });
    const bundle = buildCompiledActionBundle(result, { services });
    assert.ok(bundle);

    const valueTileId = mkOutputTileId(CoreTypeIds.String, "value");
    const rssiTileId = mkOutputTileId(CoreTypeIds.Number, "rssi");
    const valueTile = bundle.tiles.find((t) => t.tileId === valueTileId);
    const rssiTile = bundle.tiles.find((t) => t.tileId === rssiTileId);
    assert.ok(valueTile, "expected a value output tile");
    assert.ok(rssiTile, "expected an rssi output tile");
    assert.equal(valueTile.kind, "output");

    const sensorTile = bundle.tiles.find((t) => t.tileId === `tile.sensor->${TEST_PROJECT_NAMESPACE}:user.sensor.snrx`);
    assert.ok(sensorTile);

    // The sensor advertises each output's identity key; each output tile reads its own.
    const valueKey = mkOutputVarKey(CoreTypeIds.String, "value");
    const rssiKey = mkOutputVarKey(CoreTypeIds.Number, "rssi");
    assert.notEqual(valueKey, rssiKey, "distinct identities get distinct keys");
    assert.ok(sensorTile.providedOutputs().indexOf(valueKey) >= 0, "the sensor provides the value output key");
    assert.ok(sensorTile.providedOutputs().indexOf(rssiKey) >= 0, "the sensor provides the rssi output key");
    assert.equal(sensorTile.providedOutputs().size(), 2, "the sensor provides exactly its declared outputs");
  });

  test("two sensors declaring the same (type, name) share one output tile and one provided key", () => {
    const result = compileProject({
      "see.ts": sensorSource(
        "snsee",
        "see",
        `[{ name: "value", type: "string" }]`,
        `    setOutput(ctx, "value", "a");`
      ),
      "hear.ts": sensorSource(
        "snhear",
        "hear",
        `[{ name: "value", type: "string" }]`,
        `    setOutput(ctx, "value", "b");`
      ),
    });
    const bundle = buildCompiledActionBundle(result, { services });
    assert.ok(bundle);

    const valueTileId = mkOutputTileId(CoreTypeIds.String, "value");
    const valueTiles = bundle.tiles.filter((t) => t.tileId === valueTileId);
    assert.equal(valueTiles.length, 1, "a shared identity surfaces a single tile");

    const sharedKey = mkOutputVarKey(CoreTypeIds.String, "value");
    const see = bundle.tiles.find((t) => t.tileId === `tile.sensor->${TEST_PROJECT_NAMESPACE}:user.sensor.snsee`);
    const hear = bundle.tiles.find((t) => t.tileId === `tile.sensor->${TEST_PROJECT_NAMESPACE}:user.sensor.snhear`);
    assert.ok(see && hear);
    assert.ok(see.providedOutputs().indexOf(sharedKey) >= 0, "see provides the shared output key");
    assert.ok(hear.providedOutputs().indexOf(sharedKey) >= 0, "hear provides the shared output key");
  });

  test("the same name with different types is non-colliding: two distinct tiles", () => {
    const result = compileProject({
      "s.ts": sensorSource("sns", "s", `[{ name: "value", type: "string" }]`, `    setOutput(ctx, "value", "a");`),
      "n.ts": sensorSource("snn", "n", `[{ name: "value", type: "number" }]`, `    setOutput(ctx, "value", 1);`),
    });
    const bundle = buildCompiledActionBundle(result, { services });
    assert.ok(bundle);

    assert.ok(bundle.tiles.some((t) => t.tileId === mkOutputTileId(CoreTypeIds.String, "value")));
    assert.ok(bundle.tiles.some((t) => t.tileId === mkOutputTileId(CoreTypeIds.Number, "value")));
    assert.notEqual(mkOutputVarKey(CoreTypeIds.String, "value"), mkOutputVarKey(CoreTypeIds.Number, "value"));
  });
});
