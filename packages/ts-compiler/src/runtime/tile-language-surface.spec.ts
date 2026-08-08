/**
 * The `language` group of a user tile's `Sensor`/`Actuator` config: its
 * extraction into the descriptor, its flow through the bundle onto the
 * registered tile def's `metadata.language`, and the sentences a rule built
 * from those tiles projects through core's real projection engine.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core";
import type { BrainServices, IBrainRuleDef, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import { CoreCapabilityBits, mkOperatorTileId } from "@mindcraft-lang/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { projectRuleSentence, sentenceText, tileSentenceWord } from "@mindcraft-lang/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import {
  CoreOpId,
  CoreTypeIds,
  mkActuatorTileId,
  mkParameterTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/runtime";
import { UserTileProject } from "../compiler/compile.js";
import { DescriptorDiagCode } from "../compiler/diag-codes.js";
import { TEST_PROJECT_NAMESPACE } from "../testing/index.js";
import { buildCompiledActionBundle } from "./action-bundle.js";

// -- sources -----------------------------------------------------------------

/** A sensor whose only language member is the state frame. */
const STATE_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snhungry",
  name: "hungry",
  language: { frame: "state" },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

/** The same sensor with no language group at all: the pinned fallback reading. */
const UNMARKED_STATE_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snhungry",
  name: "hungry",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

/** A sensor authoring both a word and its objectless completion. */
const FORM_BARE_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snsight",
  name: "sight",
  language: { form: "see", bare: "anything" },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

/** An actuator authoring the word it reads with in the DO clause. */
const FORM_ACTUATOR = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  id: "acleap",
  name: "leap",
  language: { form: "jump" },
  onExecute(ctx: Context): void {},
});
`;

/** A sensor with neither a label nor a language group: it reads from its name. */
const UNMARKED_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snwiggle",
  name: "wiggle",
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

// -- harness -----------------------------------------------------------------

function resolveCoreTypeId(typeName: string): string | undefined {
  switch (typeName) {
    case "boolean":
      return CoreTypeIds.Boolean;
    case "number":
      return CoreTypeIds.Number;
    case "string":
      return CoreTypeIds.String;
    default:
      return undefined;
  }
}

/**
 * Compile `sources` through one project and return the bundle's tiles by tile
 * id, plus the services they resolved against. Set `allowTsErrors` for a source
 * whose program is deliberately broken, so only its tile surface contributes.
 */
function compileTiles(
  sources: Record<string, string>,
  options: { allowTsErrors?: boolean } = {}
): {
  services: BrainServices;
  tiles: Map<string, IBrainTileDef>;
} {
  const services = __test__createBrainServices();
  const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services });
  project.setFiles(new Map(Object.entries(sources)));
  const result = project.compileAll();
  if (!options.allowTsErrors) {
    assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
  }
  const bundle = buildCompiledActionBundle(result, { resolveTypeId: resolveCoreTypeId, services });
  assert.ok(bundle, "expected a compiled bundle");
  const tiles = new Map<string, IBrainTileDef>();
  for (const tile of bundle.tiles) {
    tiles.set(tile.tileId, tile);
  }
  return { services, tiles };
}

/** Compile one source file and return its compile entry, keeping malformed configs' diagnostics. */
function compileOne(fileName: string, source: string) {
  const services = __test__createBrainServices();
  const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services });
  project.setFiles(new Map([[fileName, source]]));
  const result = project.compileAll();
  const entry = result.results.get(fileName);
  assert.ok(entry, `expected a compile entry for ${fileName}`);
  return entry;
}

function sensorTileId(actionId: string): string {
  return mkSensorTileId(`${TEST_PROJECT_NAMESPACE}:user.sensor.${actionId}`);
}

function actuatorTileId(actionId: string): string {
  return mkActuatorTileId(`${TEST_PROJECT_NAMESPACE}:user.actuator.${actionId}`);
}

function requireTile(tiles: Map<string, IBrainTileDef>, tileId: string): IBrainTileDef {
  const tile = tiles.get(tileId);
  assert.ok(tile, `expected tile ${tileId} in the bundle`);
  return tile;
}

/** Build a rule on a real brain document from the tiles of each side. */
function makeRule(
  services: BrainServices,
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[]
): { rule: IBrainRuleDef; brainDef: BrainDef } {
  const brainDef = BrainDef.emptyBrainDef(services, "tile-language-surface");
  const rule = brainDef.pages().get(0).children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) {
    __test__appendTile(rule.when(), tileDef);
  }
  for (const tileDef of doTiles) {
    __test__appendTile(rule.do(), tileDef);
  }
  return { rule, brainDef };
}

/** The sentence a rule of these tiles projects, through the brain's own localizer. */
function projectedText(
  services: BrainServices,
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[] = []
): string {
  const { rule, brainDef } = makeRule(services, whenTiles, doTiles);
  const localizer = brainDef.servicesLocalizer();
  return sentenceText(projectRuleSentence(rule, localizer), localizer);
}

// -- the authored group reaches the tile def ---------------------------------

describe("SensorConfig / ActuatorConfig `language`", () => {
  test("a sensor's frame reaches the tile def's metadata", () => {
    const { tiles } = compileTiles({ "hungry.ts": STATE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snhungry"));
    assert.equal(tile.metadata?.language?.frame, "state");
    assert.equal(tile.metadata?.language?.form, undefined, "an unauthored member stays unset");
    assert.equal(tile.metadata?.language?.bare, undefined);
  });

  test("a sensor's form and bare reach the tile def's metadata", () => {
    const { tiles } = compileTiles({ "sight.ts": FORM_BARE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snsight"));
    assert.equal(tile.metadata?.language?.form, "see");
    assert.equal(tile.metadata?.language?.bare, "anything");
    assert.equal(tile.metadata?.language?.frame, undefined);
  });

  test("an actuator's form reaches the tile def's metadata", () => {
    const { tiles } = compileTiles({ "leap.ts": FORM_ACTUATOR });
    const tile = requireTile(tiles, actuatorTileId("acleap"));
    assert.equal(tile.metadata?.language?.form, "jump");
  });

  test("a tile with no language group carries no language metadata", () => {
    const { tiles } = compileTiles({ "wiggle.ts": UNMARKED_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snwiggle"));
    assert.equal(tile.metadata?.language, undefined);
  });

  test("the group survives on a tile whose program failed to compile, from the surface definition", () => {
    const broken = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snbroken",
  name: "broken",
  language: { frame: "state" },
  onExecute(ctx: Context): boolean {
    return missingBinding;
  },
});
`;
    const { tiles } = compileTiles({ "broken.ts": broken }, { allowTsErrors: true });
    const tile = requireTile(tiles, sensorTileId("snbroken"));
    assert.equal(tile.metadata?.language?.frame, "state", "the tile-surface definition carries the group too");
  });
});

// -- the sentences (end-to-end goldens) --------------------------------------

describe("projected sentences of user tiles", () => {
  test("a state-framed sensor reads with the copula", () => {
    const { services, tiles } = compileTiles({ "hungry.ts": STATE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snhungry"));
    assert.equal(projectedText(services, [tile]), "When I am hungry,");
  });

  test("the same sensor without the group reads through the default frame", () => {
    const { services, tiles } = compileTiles({ "hungry.ts": UNMARKED_STATE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snhungry"));
    assert.equal(projectedText(services, [tile]), "When I hungry,");
  });

  test("an authored bare word completes an objectless sensor", () => {
    const { services, tiles } = compileTiles({ "sight.ts": FORM_BARE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snsight"));
    assert.equal(projectedText(services, [tile]), "When I see anything,");
  });

  test("an actuator's form reads in the DO clause", () => {
    const { services, tiles } = compileTiles({ "hungry.ts": STATE_SENSOR, "leap.ts": FORM_ACTUATOR });
    const sensor = requireTile(tiles, sensorTileId("snhungry"));
    const actuator = requireTile(tiles, actuatorTileId("acleap"));
    assert.equal(projectedText(services, [sensor], [actuator]), "When I am hungry, jump.");
  });

  test("an unmarked tile reads plainly from its name", () => {
    const { services, tiles } = compileTiles({ "wiggle.ts": UNMARKED_SENSOR, "leap.ts": FORM_ACTUATOR });
    const sensor = requireTile(tiles, sensorTileId("snwiggle"));
    const actuator = requireTile(tiles, actuatorTileId("acleap"));
    assert.equal(projectedText(services, [sensor], [actuator]), "When I wiggle, jump.");
  });
});

// -- the interaction sweep ---------------------------------------------------

describe("`language` against `label`", () => {
  const LABELED_WITH_FORM = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snlabform",
  name: "sight",
  label: "spots",
  language: { form: "see" },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

  const LABELED_WITHOUT_FORM = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snlabonly",
  name: "sight",
  label: "spots",
  language: { frame: "state" },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;

  test("an authored form wins over the label", () => {
    const { services, tiles } = compileTiles({ "lab-form.ts": LABELED_WITH_FORM });
    const tile = requireTile(tiles, sensorTileId("snlabform"));
    assert.equal(tile.metadata?.label, "spots", "the label is untouched");
    assert.equal(projectedText(services, [tile]), "When I see,");
  });

  test("a group without a form reads the label through its frame", () => {
    const { services, tiles } = compileTiles({ "lab-only.ts": LABELED_WITHOUT_FORM });
    const tile = requireTile(tiles, sensorTileId("snlabonly"));
    assert.equal(projectedText(services, [tile]), "When I am spots,");
  });
});

describe("`language` on an inline sensor", () => {
  const INLINE_STATE_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snlevel",
  name: "level",
  inline: true,
  language: { form: "warm", frame: "state" },
  onExecute(ctx: Context): number {
    return 3;
  },
});
`;

  test("an inline sensor alone on the WHEN side reads with no subject, still using its form", () => {
    const { services, tiles } = compileTiles({ "level.ts": INLINE_STATE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snlevel"));
    assert.equal(projectedText(services, [tile]), "When warm,");
  });

  test("an inline sensor continued by an expression reads subjectlessly, still using its form", () => {
    const { services, tiles } = compileTiles({ "level.ts": INLINE_STATE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snlevel"));
    const plus = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Add));
    assert.ok(plus, "the core add operator is registered");
    const one = new BrainTileLiteralDef(CoreTypeIds.Number, 1, {}, services);
    const text = projectedText(services, [tile, plus, one]);
    assert.equal(text.includes("When I am"), false, "a continued inline head takes no frame template");
    assert.equal(text.includes("warm"), true, "the head still reads with its authored form");
  });
});

describe("`language` on a presence-gated sensor", () => {
  const GATED_STATE_SENSOR = `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "snthirst",
  name: "thirst",
  presenceGated: true,
  language: { form: "thirsty", frame: "state" },
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

  test("the gate bit and the group are independent and both land", () => {
    const { services, tiles } = compileTiles({ "thirst.ts": GATED_STATE_SENSOR });
    const tile = requireTile(tiles, sensorTileId("snthirst"));
    assert.equal(tile.capabilities().get(CoreCapabilityBits.PresenceGated), 1);
    assert.equal(tile.metadata?.language?.form, "thirsty");
    assert.equal(tile.metadata?.language?.frame, "state");
    assert.equal(projectedText(services, [tile]), "When I am thirsty,", "the authored frame selects the template");
  });
});

describe("`language` on a sensor with args and outputs", () => {
  const ARGS_AND_OUTPUTS_SENSOR = `
import { param, Sensor, setOutput, type Context } from "mindcraft";

export default Sensor({
  id: "snscan",
  name: "scan",
  language: { form: "spot", frame: "verb" },
  args: [param("range", { type: "number" })],
  outputs: [{ name: "distance", type: "number" }],
  onExecute(ctx: Context, args: { range: number }): boolean {
    setOutput(ctx, "distance", args.range);
    return true;
  },
});
`;

  test("the group marks only the sensor's own word; its arg and output tiles are untouched", () => {
    const { services, tiles } = compileTiles({ "scan.ts": ARGS_AND_OUTPUTS_SENSOR });
    const sensor = requireTile(tiles, sensorTileId("snscan"));
    assert.equal(sensor.metadata?.language?.form, "spot");

    const paramTile = requireTile(tiles, mkParameterTileId(`${TEST_PROJECT_NAMESPACE}:user.snscan.range`));
    assert.equal(paramTile.metadata?.language, undefined, "arg-tile language is out of scope for this surface");

    const outputTile = [...tiles.values()].find((tile) => tile.kind === "output");
    assert.ok(outputTile, "expected the sensor's output value-tile in the bundle");
    assert.equal(outputTile.metadata?.language, undefined);

    const localizer = BrainDef.emptyBrainDef(services, "words").servicesLocalizer();
    assert.equal(tileSentenceWord(sensor, localizer), "spot");
    assert.equal(tileSentenceWord(outputTile, localizer), "distance", "an output still reads from its own name");
  });
});

describe("`language` on an actuator's inert frame", () => {
  const FRAMED_ACTUATOR = `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  id: "acrest",
  name: "rest",
  language: { form: "nap", frame: "state" },
  onExecute(ctx: Context): void {},
});
`;

  test("a frame on an actuator is carried but changes no sentence", () => {
    const { services, tiles } = compileTiles({ "hungry.ts": STATE_SENSOR, "rest.ts": FRAMED_ACTUATOR });
    const sensor = requireTile(tiles, sensorTileId("snhungry"));
    const actuator = requireTile(tiles, actuatorTileId("acrest"));
    assert.equal(actuator.metadata?.language?.frame, "state", "the group keeps shape parity with the tile surface");
    assert.equal(projectedText(services, [sensor], [actuator]), "When I am hungry, nap.");
  });
});

// -- reconcile and compile-history independence ------------------------------

/** Read the tile registered under `tileId` from an environment's live catalog chain. */
function registeredTile(catalogs: Iterable<ITileCatalog>, tileId: string): IBrainTileDef | undefined {
  for (const catalog of catalogs) {
    const found = catalog.get(tileId);
    if (found) return found;
  }
  return undefined;
}

describe("recompiling a tile's language group", () => {
  test("adding and removing the group both reach the live registered tile", () => {
    const env = createMindcraftEnvironment({ modules: [coreModule()] });
    const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services: env.brainServices });

    const applyCompile = (): void => {
      const result = project.compileAll();
      assert.equal(result.tsErrors.size, 0, `TS errors: ${JSON.stringify([...result.tsErrors])}`);
      const bundle = buildCompiledActionBundle(result, { services: env.brainServices });
      assert.ok(bundle);
      env.replaceActionBundle(bundle);
    };

    const tileId = sensorTileId("snhungry");
    const liveTile = (): IBrainTileDef => {
      const tile = registeredTile(env.tileCatalogs(), tileId);
      assert.ok(tile, "the sensor tile is registered");
      return tile;
    };
    const sentence = (): string => projectedText(env.brainServices, [liveTile()]);

    project.setFiles(new Map([["hungry.ts", UNMARKED_STATE_SENSOR]]));
    applyCompile();
    assert.equal(sentence(), "When I hungry,", "the unmarked tile reads plainly");

    project.updateFile("hungry.ts", STATE_SENSOR);
    applyCompile();
    assert.equal(liveTile().metadata?.language?.frame, "state", "the added group reaches the registered tile");
    assert.equal(sentence(), "When I am hungry,", "the sentence re-reads without a reload");

    project.updateFile("hungry.ts", UNMARKED_STATE_SENSOR);
    applyCompile();
    assert.equal(liveTile().metadata?.language, undefined, "removing the group clears it from the registered tile");
    assert.equal(sentence(), "When I hungry,", "the sentence returns to the plain reading");
  });
});

describe("compile-history independence", () => {
  test("a warm project compiles the group identically to a fresh one", () => {
    const services = __test__createBrainServices();
    const warm = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services });

    warm.setFiles(new Map([["other.ts", FORM_BARE_SENSOR]]));
    warm.compileAll();
    warm.deletePath("other.ts");
    warm.updateFile("hungry.ts", STATE_SENSOR);
    const warmResult = warm.compileAll();
    const warmBundle = buildCompiledActionBundle(warmResult, { resolveTypeId: resolveCoreTypeId, services });
    assert.ok(warmBundle);
    const warmTile = warmBundle.tiles.find((tile) => tile.tileId === sensorTileId("snhungry"));
    assert.ok(warmTile);

    const { tiles: freshTiles } = compileTiles({ "hungry.ts": STATE_SENSOR });
    const freshTile = requireTile(freshTiles, sensorTileId("snhungry"));

    assert.deepEqual(warmTile.metadata?.language, freshTile.metadata?.language);
  });
});

// -- malformed groups block precisely ----------------------------------------

describe("malformed `language` groups", () => {
  test("a non-object-literal language emits LanguageMustBeObjectLiteral", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const shared = { frame: "state" as const };
export default Sensor({
  name: "dyn-language",
  language: shared,
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const entry = compileOne("dyn-language.ts", source);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.LanguageMustBeObjectLiteral),
      `expected LanguageMustBeObjectLiteral, got ${JSON.stringify(entry.diagnostics)}`
    );
    assert.equal(entry.program, undefined, "a malformed group blocks program assembly");
  });

  test("a non-literal form emits LanguageFormMustBeStringLiteral", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const word: string = "see";
export default Sensor({
  name: "dyn-form",
  language: { form: word },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const entry = compileOne("dyn-form.ts", source);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.LanguageFormMustBeStringLiteral),
      `expected LanguageFormMustBeStringLiteral, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("a non-literal frame emits LanguageFrameMustBeFrameName", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const chosen: "verb" | "state" = "state";
export default Sensor({
  name: "dyn-frame",
  language: { frame: chosen },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const entry = compileOne("dyn-frame.ts", source);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.LanguageFrameMustBeFrameName),
      `expected LanguageFrameMustBeFrameName, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("a non-literal bare emits LanguageBareMustBeStringLiteral", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const word: string = "anything";
export default Sensor({
  name: "dyn-bare",
  language: { bare: word },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const entry = compileOne("dyn-bare.ts", source);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.LanguageBareMustBeStringLiteral),
      `expected LanguageBareMustBeStringLiteral, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("a spread inside the group emits ConfigMemberNotInline", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
const base = { form: "see" };
export default Sensor({
  name: "spread-language",
  language: { ...base },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const entry = compileOne("spread-language.ts", source);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.ConfigMemberNotInline),
      `expected ConfigMemberNotInline, got ${JSON.stringify(entry.diagnostics)}`
    );
  });

  test("an unknown frame name is a TypeScript error on the config surface", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  name: "bad-frame",
  language: { frame: "shouty" },
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const services = __test__createBrainServices();
    const project = new UserTileProject({ projectNamespace: TEST_PROJECT_NAMESPACE, services });
    project.setFiles(new Map([["bad-frame.ts", source]]));
    const result = project.compileAll();
    assert.ok(result.tsErrors.size > 0, "the frame union rejects an unknown frame name");
    const entry = result.results.get("bad-frame.ts");
    assert.ok(entry);
    assert.ok(
      entry.diagnostics.some((d) => d.code === DescriptorDiagCode.LanguageFrameMustBeFrameName),
      "extraction blocks it too, so the tile never registers an unknown frame"
    );
  });

  test("an empty group is accepted and reads as an unmarked tile", () => {
    const source = `
import { Sensor, type Context } from "mindcraft";
export default Sensor({
  id: "snempty",
  name: "hungry",
  language: {},
  onExecute(ctx: Context): boolean {
    return true;
  },
});
`;
    const { services, tiles } = compileTiles({ "empty.ts": source });
    const tile = requireTile(tiles, sensorTileId("snempty"));
    assert.equal(tile.metadata?.language?.form, undefined);
    assert.equal(tile.metadata?.language?.frame, undefined);
    assert.equal(projectedText(services, [tile]), "When I hungry,");
  });
});
