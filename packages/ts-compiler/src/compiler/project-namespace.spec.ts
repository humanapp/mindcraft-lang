import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createWendooEnvironment } from "@wendoo-lang/core";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import { buildCompiledActionBundle } from "../runtime/action-bundle.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { buildAmbientDeclarations } from "./ambient.js";
import { UserTileProject } from "./project.js";

const SOURCE = `import { Sensor, StructType, NumberType, type Context } from "wendoo";

export const Position = StructType({
  name: "Position",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
});

export default Sensor({
  name: "probe-sensor",
  id: "probeSensorId12345",
  returnType: Position,
  onExecute(ctx: Context) {
    return Position({ x: 1, y: 2 });
  },
});
`;

function compileUnder(namespace: string) {
  const services = __test__createBrainServices();
  const project = new UserTileProject({
    projectNamespace: namespace,
    ambientFiles: [{ path: "ambient.d.ts", content: buildAmbientDeclarations(services.runtime.types) }],
    services,
  });
  project.updateFile("main.ts", SOURCE);
  const result = project.compileAll();
  const program = result.results.get("main.ts")?.program;
  assert.ok(program, JSON.stringify([...result.tsErrors], null, 2));
  return { services, project, program };
}

describe("project-namespaced symbol keys", () => {
  test("every symbol minted from project content carries the project namespace", () => {
    const { services, program } = compileUnder(TEST_PROJECT_NAMESPACE);

    assert.equal(program.projectNamespace, TEST_PROJECT_NAMESPACE);
    assert.equal(program.key, `${TEST_PROJECT_NAMESPACE}:user.sensor.probeSensorId12345`);

    const structInfo = program.structTypes?.[0];
    assert.ok(structInfo);
    assert.equal(structInfo.identity, `${TEST_PROJECT_NAMESPACE}:/main.ts::Position`);
    assert.equal(structInfo.typeId, `struct:<${TEST_PROJECT_NAMESPACE}:/main.ts::Position>`);
    assert.equal(
      services.runtime.types.resolveByName(`${TEST_PROJECT_NAMESPACE}:/main.ts::Position`),
      structInfo.typeId
    );
    assert.equal(services.runtime.types.resolveByName("/main.ts::Position"), undefined);
  });

  test("the same declaration under two namespaces registers two distinct types", () => {
    const a = compileUnder("project-a");
    const b = compileUnder("project-b");

    const typeA = a.program.structTypes?.[0]?.typeId;
    const typeB = b.program.structTypes?.[0]?.typeId;
    assert.ok(typeA && typeB);
    assert.notEqual(typeA, typeB);
    assert.notEqual(a.program.key, b.program.key);
  });

  test("the same file and binding registers once within one namespace (register-if-absent)", () => {
    const { services, project, program } = compileUnder("project-a");
    const firstTypeId = program.structTypes?.[0]?.typeId;
    assert.ok(firstTypeId);

    const again = project.compileAll();
    const reProgram = again.results.get("main.ts")?.program;
    assert.ok(reProgram);
    assert.equal(reProgram.structTypes?.[0]?.typeId, firstTypeId);
    assert.equal(services.runtime.types.resolveByName("project-a:/main.ts::Position"), firstTypeId);
  });
  test("a saved brain referencing a pre-namespace tile id degrades to a missing placeholder without crashing", () => {
    const { services, program } = compileUnder(TEST_PROJECT_NAMESPACE);
    const project = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: [{ path: "ambient.d.ts", content: buildAmbientDeclarations(services.runtime.types) }],
      services,
    });
    project.updateFile("main.ts", SOURCE);
    const bundle = buildCompiledActionBundle(project.compileAll(), { services });
    assert.ok(bundle);

    const environment = createWendooEnvironment({ modules: [coreModule()] });
    environment.hydrateTileMetadata({ revision: bundle.revision, tiles: bundle.tiles });
    environment.replaceActionBundle(bundle);

    const sensorTile = bundle.tiles.find((tile) => tile.kind === "sensor");
    assert.ok(sensorTile);
    const brainDef = BrainDef.emptyBrainDef(services, "Legacy Brain");
    brainDef.pages().get(0)!.children().get(0)!.when().appendTile(sensorTile);

    const legacyJsonText = JSON.stringify(brainDef.toJson())
      .split(`${TEST_PROJECT_NAMESPACE}:user.sensor.`)
      .join("user.sensor.");
    const restored = environment.deserializeBrainJsonFromPlain(JSON.parse(legacyJsonText), TEST_PROJECT_NAMESPACE);
    const restoredTile = restored.pages().get(0)!.children().get(0)!.when().tiles().get(0)!;
    assert.equal(restoredTile.kind, "missing", "a pre-namespace tile id must degrade to a missing placeholder");
  });
});
