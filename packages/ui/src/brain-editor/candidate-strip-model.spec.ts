/**
 * Pins the inline candidate strip's decision logic: what the oracle's
 * suggestions flatten into, how filter text ranks the offering, how the default
 * ranker orders the offering by category priority and then by provenance, which
 * candidate a commit key places, that unknown text can never commit, that typed
 * digits mint a literal candidate, that an unknown word and the `$` accelerator
 * mint variable candidates of the types the position accepts, which
 * presentation each candidate renders in, and that a word of a multi-word form
 * commits without the words ahead of it.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import {
  CoreControlFlowId,
  CoreLiteralFactoryId,
  CoreVariableFactoryId,
  isVariableFactoryTileId,
  LiteralDisplayFormats,
  mkControlFlowTileId,
  mkLiteralFactoryTileId,
  mkModifierTileId,
  mkOperatorTileId,
  mkVariableFactoryTileId,
  percentFormat,
  RuleSide,
  TilePlacement,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import {
  suggestTiles,
  TileCompatibility,
  type TileSuggestion,
  type TileSuggestionResult,
  tileSentenceWord,
} from "@mindcraft-lang/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainTileActuatorDef,
  type BrainTileFactoryDef,
  type BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTileSensorDef,
  type BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import {
  bag,
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  choice,
  mkActionDescriptor,
  mkActuatorTileId,
  mkCallDef,
  mkSensorTileId,
  mod,
  optional,
  type TypeId,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";
import type { ArmedTileTarget } from "./ArmedTargetContext";
import {
  arrangeCandidateSubcategories,
  buildStripCandidates,
  type CandidateProvenanceContext,
  candidateProvenanceBand,
  categoryPriorityCandidateRanker,
  classifyTileMatch,
  decideCandidateCommit,
  filterStripCandidates,
  groupStripCandidates,
  identityCandidateRanker,
  isUnknownFilterText,
  mintNumberLiteralCandidate,
  mintTextLiteralCandidate,
  mintVariableCandidates,
  offersTextLiteral,
  parseStripFilter,
  resolveStripOffering,
  type StripCandidate,
  tileCandidateGroup,
  toCandidateEntries,
} from "./candidate-strip-model";
import { kBestNextCandidateCount } from "./hooks/useCandidateStrip";
import { manufactureLiteralTile, manufactureVariableTile } from "./hooks/useTileSelection";
import { buildInsertionContext } from "./insertion-context";
import type { TileSourceLibrary } from "./tile-library-groups";

let services: BrainServices;

/** The match quality each sensor of the "see" collision set carries against the filter text "see". */
type SeeMatchTier = "fuzzy" | "substring" | "prefixFirst" | "prefixSecond" | "exact";

let seeTileIds: Record<SeeMatchTier, string>;

/** Tile ids of the actuators registered for the DO-side ranking assertions, in registration order. */
let rankingActuatorTileIds: string[];

/**
 * Register real sensor tiles whose labels all match the filter text "see" at
 * different qualities, in worst-match-first order so the oracle offers them
 * that way. Returns each sensor's tile id, keyed by the quality its label
 * matches "see" with.
 */
function registerSeeCollisionSensors(): Record<SeeMatchTier, string> {
  const specs: readonly (readonly [SeeMatchTier, string, string, number])[] = [
    ["fuzzy", "strip-see-fuzzy", "previous page", 4900],
    ["substring", "strip-see-substring", "oversee", 4901],
    ["prefixFirst", "strip-see-prefix-first", "seesaw", 4902],
    ["prefixSecond", "strip-see-prefix-second", "seeds", 4903],
    ["exact", "strip-see-exact", "see", 4904],
  ];
  const tileIds = {} as Record<SeeMatchTier, string>;
  for (const [tier, sensorId, label, fnId] of specs) {
    const fnEntry = services.runtime.functions.register(
      fnId,
      sensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(bag())
    );
    const tileDef = new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
      metadata: { label },
    });
    services.edit.tiles.registerTileDef(tileDef);
    tileIds[tier] = tileDef.tileId;
  }
  return tileIds;
}

/**
 * Register real actuator tiles so the empty DO side offers more actions than
 * the core catalog alone does. Returns their tile ids in registration order.
 */
function registerRankingActuators(): string[] {
  const specs: readonly (readonly [string, string, number])[] = [
    ["strip-rank-move", "move", 4905],
    ["strip-rank-turn", "turn", 4906],
    ["strip-rank-glide", "glide", 4907],
  ];
  const tileIds: string[] = [];
  for (const [actuatorId, label, fnId] of specs) {
    const fnEntry = services.runtime.functions.register(
      fnId,
      actuatorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(bag())
    );
    const tileDef = new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {
      metadata: { label },
    });
    services.edit.tiles.registerTileDef(tileDef);
    tileIds.push(tileDef.tileId);
  }
  return tileIds;
}

/** Namespace of the project whose own compiled TypeScript the provenance probes stand in for. */
const kProjectNamespace = "strip-provenance-project";

/** Coordinate of the installed library the library-provenance probe is attributed to. */
const kLibraryCoordinate = "strip-owner/strip-lib";

/** Coordinate of the second installed library, registered after the first and named ahead of it. */
const kSecondLibraryCoordinate = "strip-owner/strip-lib-alt";

/** Display name of {@link kLibraryCoordinate}, which sorts after {@link kSecondLibraryName}. */
const kLibraryName = "Zephyr Motors";

/** Display name of {@link kSecondLibraryCoordinate}, which sorts ahead of {@link kLibraryName}. */
const kSecondLibraryName = "Aster Sensors";

/** The installed libraries the subcategory arrangement resolves display names against. */
const installedLibraries: readonly TileSourceLibrary[] = [
  { coordinate: kLibraryCoordinate, name: kLibraryName },
  { coordinate: kSecondLibraryCoordinate, name: kSecondLibraryName },
];

/** The layer a provenance probe sensor stands in for. */
type ProvenanceProbe = "library" | "libraryAlt" | "project" | "platform";

let provenanceSensorTileIds: Record<ProvenanceProbe, string>;

/** Tile id of the platform-level inline sensor, which files under the function group. */
let platformInlineSensorTileId: string;

/**
 * Register real sensors covering each provenance layer, in library-then-project-
 * then-platform order so the oracle offers them in an order the band sort has to
 * change, and a second library sensor last whose library is named ahead of the
 * first. The platform sensor carries no identity namespace, exactly as a host
 * app's own registrations do. Returns each sensor's tile id keyed by its layer.
 */
function registerProvenanceSensors(): Record<ProvenanceProbe, string> {
  const specs: readonly (readonly [ProvenanceProbe, string, string, number, string | undefined])[] = [
    ["library", "strip-prov-library", "scan", 4910, kLibraryCoordinate],
    ["project", "strip-prov-project", "sniff", 4911, kProjectNamespace],
    ["platform", "strip-prov-platform", "listen", 4912, undefined],
    ["libraryAlt", "strip-prov-library-alt", "ping", 4914, kSecondLibraryCoordinate],
  ];
  const tileIds = {} as Record<ProvenanceProbe, string>;
  for (const [probe, sensorId, label, fnId, namespace] of specs) {
    const fnEntry = services.runtime.functions.register(
      fnId,
      sensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(bag())
    );
    const tileDef = new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
      metadata: { label },
      userIdentity: namespace === undefined ? undefined : { namespace, actionId: sensorId },
    });
    services.edit.tiles.registerTileDef(tileDef);
    tileIds[probe] = tileDef.tileId;
  }
  return tileIds;
}

/**
 * Register a platform-level inline sensor. Inline sensors file under the
 * function group, so this tile ranks in the content tier on the WHEN side while
 * carrying application provenance. Returns its tile id.
 */
function registerPlatformInlineSensor(): string {
  const fnEntry = services.runtime.functions.register(
    4913,
    "strip-prov-inline",
    false,
    { exec: () => VOID_VALUE },
    mkCallDef(bag())
  );
  const tileDef = new BrainTileSensorDef(
    "strip-prov-inline",
    mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Number),
    {
      metadata: { label: "distance" },
      placement: TilePlacement.EitherSide | TilePlacement.Inline,
    }
  );
  services.edit.tiles.registerTileDef(tileDef);
  return tileDef.tileId;
}

/** Modifier ids of the object modifiers whose sentence words open with an article. */
const articleModifierIds = {
  carnivore: "strip-object-carnivore",
  plant: "strip-object-plant",
} as const;

/** Tile id of the object modifier `modifierId` names. */
function articleModifierTileId(modifierId: string): string {
  return mkModifierTileId(modifierId);
}

/**
 * Register object modifier tiles worded as the host apps' own object tiles are:
 * the label is the bare noun a user types, and the sentence form the chip is
 * labelled with opens with an article.
 */
function registerArticleModifiers(): void {
  const specs: readonly (readonly [string, string, string])[] = [
    [articleModifierIds.carnivore, "carnivore", "a carnivore"],
    [articleModifierIds.plant, "plant", "a plant"],
  ];
  for (const [tileId, label, form] of specs) {
    services.edit.tiles.registerTileDef(new BrainTileModifierDef(tileId, { metadata: { label, language: { form } } }));
  }
}

/** Tile id of the sensor whose one optional slot takes an article-bearing object modifier. */
let objectSensorTileId: string;

/** Register a sensor shaped like the apps' object sensors: one optional choice of object modifiers. */
function registerObjectSensor(): string {
  const fnEntry = services.runtime.functions.register(
    4915,
    "strip-object-sensor",
    false,
    { exec: () => VOID_VALUE },
    mkCallDef(bag(optional(choice(mod(articleModifierIds.carnivore), mod(articleModifierIds.plant)))))
  );
  const tileDef = new BrainTileSensorDef(
    "strip-object-sensor",
    mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean),
    { metadata: { label: "bump", language: { form: "bump" } } }
  );
  services.edit.tiles.registerTileDef(tileDef);
  return tileDef.tileId;
}

before(() => {
  services = __test__createBrainServices();
  seeTileIds = registerSeeCollisionSensors();
  rankingActuatorTileIds = registerRankingActuators();
  provenanceSensorTileIds = registerProvenanceSensors();
  platformInlineSensorTileId = registerPlatformInlineSensor();
  registerArticleModifiers();
  objectSensorTileId = registerObjectSensor();
});

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

/** A candidate over a real tile def, labelled for the filter and commit assertions. */
function candidate(tileId: string, label: string): StripCandidate {
  const tileDef = coreTile(tileId);
  return {
    key: `${tileId}:${label}`,
    tileDef,
    label,
    group: tileCandidateGroup(tileDef),
    viaConversion: false,
    origin: { kind: "suggested" },
  };
}

/** A candidate over a real tile def that fits its position only through a conversion. */
function conversionCandidate(tileId: string, label: string): StripCandidate {
  return { ...candidate(tileId, label), key: `conv:${tileId}:${label}`, viaConversion: true };
}

function suggestion(tileId: string, conversionCost: number): TileSuggestion {
  return {
    tileDef: coreTile(tileId),
    compatibility: conversionCost === 0 ? TileCompatibility.Exact : TileCompatibility.Conversion,
    conversionCost,
  };
}

function result(exact: TileSuggestion[], withConversion: TileSuggestion[]): TileSuggestionResult {
  return { exact: List.from(exact), withConversion: List.from(withConversion) };
}

/**
 * The label the strip resolves a tile by, exactly as the strip itself does: the
 * word the tile's sentence reads it as, which is a variable's own name, a
 * literal's value, and every other tile's authored form or label.
 */
function stripLabel(tileDef: IBrainTileDef): string {
  return tileSentenceWord(tileDef, services.app.localizer);
}

/**
 * The word each tile's sentence reads it as, resolved against `brain`'s own
 * localizer: the label the strip puts on its chips, and the reading a formatted
 * literal carries.
 */
function sentenceLabel(brain: BrainDef): (tileDef: IBrainTileDef) => string {
  const localizer = brain.servicesLocalizer();
  return (tileDef) => tileSentenceWord(tileDef, localizer);
}

/** What an offering is built for beyond the side it is armed on. */
interface OfferingOptions {
  /** The type the armed position expects, which narrows the offering to tiles that produce it. */
  expectedType?: TypeId;
  /** Runs against the fresh brain before the oracle is queried, so its catalog can be populated. */
  prepare?: (brain: BrainDef) => void;
}

/** The oracle's offering for an empty side of a fresh brain's first rule, with the target that arms that side. */
function offeringForEmptySide(
  side: RuleSide,
  options: OfferingOptions = {}
): {
  candidates: StripCandidate[];
  brain: BrainDef;
  target: ArmedTileTarget;
} {
  const brain = BrainDef.emptyBrainDef(services);
  options.prepare?.(brain);
  const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
  const catalogs = List.from<ITileCatalog>([services.edit.tiles, brain.catalog()]).asReadonly();
  const tileSet = side === RuleSide.When ? rule.when() : rule.do();
  const context = buildInsertionContext({
    side,
    expectedType: options.expectedType,
    expr: tileSet.expr(),
    existingTiles: tileSet.tiles(),
    ruleDef: rule,
  });
  const suggested = suggestTiles(context, catalogs, services);
  return {
    candidates: buildStripCandidates(suggested, stripLabel),
    brain,
    target: { ruleDef: rule, side, mode: "append", onTileSelected: () => true },
  };
}

/** The oracle's offering for the empty WHEN side of a fresh brain's first rule. */
function offeringForEmptyWhenSide(): { candidates: StripCandidate[]; brain: BrainDef; target: ArmedTileTarget } {
  return offeringForEmptySide(RuleSide.When);
}

/** The tile ids of the "see" collision sensors present in `candidates`, in list order. */
function seeCollisionOrder(candidates: readonly StripCandidate[]): string[] {
  const collisionIds = new Set(Object.values(seeTileIds));
  return candidates.map((c) => c.tileDef.tileId).filter((tileId) => collisionIds.has(tileId));
}

const onPageEnteredTileId = mkSensorTileId(CoreHostActions.OnPageEntered.key);
const timeoutTileId = mkSensorTileId(CoreHostActions.Timeout.key);
const switchPageTileId = mkActuatorTileId(CoreHostActions.SwitchPage.key);

/** The provenance the ranker assertions resolve bands against. */
const provenanceContext: CandidateProvenanceContext = { projectNamespace: kProjectNamespace };

const notTileId = mkOperatorTileId(CoreOpId.Not);
const negTileId = mkOperatorTileId(CoreOpId.Negate);
const numberVarFactoryId = mkVariableFactoryTileId(CoreVariableFactoryId.Number);
const numberLiteralFactoryId = mkLiteralFactoryTileId(CoreLiteralFactoryId.Number);
const stringLiteralFactoryId = mkLiteralFactoryTileId(CoreLiteralFactoryId.String);
const openParenTileId = mkControlFlowTileId(CoreControlFlowId.OpenParen);
const booleanVarFactoryId = mkVariableFactoryTileId(CoreVariableFactoryId.Boolean);
const stringVarFactoryId = mkVariableFactoryTileId(CoreVariableFactoryId.String);

/** The bare structural tokens and create-variable factories that rank behind concrete content tiles. */
const demotedTileIds = [
  notTileId,
  negTileId,
  openParenTileId,
  booleanVarFactoryId,
  numberVarFactoryId,
  stringVarFactoryId,
];

describe("buildStripCandidates", () => {
  test("offers exact matches in oracle order, then conversion matches by cost", () => {
    const candidates = buildStripCandidates(
      result([suggestion(notTileId, 0)], [suggestion(numberVarFactoryId, 3), suggestion(negTileId, 1)]),
      (tileDef) => tileDef.tileId
    );

    assert.deepEqual(
      candidates.map((c) => c.tileDef.tileId),
      [notTileId, negTileId, numberVarFactoryId]
    );
    assert.deepEqual(
      candidates.map((c) => c.viaConversion),
      [false, true, true]
    );
  });

  test("assigns every candidate a unique key", () => {
    const { candidates } = offeringForEmptyWhenSide();
    assert.ok(candidates.length > 0);
    assert.equal(new Set(candidates.map((c) => c.key)).size, candidates.length);
  });
});

describe("filterStripCandidates", () => {
  test("an empty filter offers every candidate", () => {
    const candidates = [candidate(notTileId, "not"), candidate(negTileId, "negate")];
    assert.deepEqual(
      filterStripCandidates(candidates, "").map((c) => c.label),
      ["not", "negate"]
    );
  });

  test("narrows to the candidates whose labels match", () => {
    const candidates = [
      candidate(notTileId, "not"),
      candidate(negTileId, "negate"),
      candidate(numberVarFactoryId, "number"),
    ];
    assert.deepEqual(
      filterStripCandidates(candidates, "ne").map((c) => c.label),
      ["negate", "number"]
    );
  });
});

describe("filterStripCandidates ranking", () => {
  test("the offering leads with the bag match the exact-label tile has to outrank", () => {
    const { candidates } = offeringForEmptyWhenSide();

    assert.deepEqual(seeCollisionOrder(candidates), [
      seeTileIds.fuzzy,
      seeTileIds.substring,
      seeTileIds.prefixFirst,
      seeTileIds.prefixSecond,
      seeTileIds.exact,
    ]);
  });

  test("the exact-label candidate is the top match, ahead of a bag match offered before it", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const visible = filterStripCandidates(candidates, "see");

    assert.equal(visible[0]?.tileDef.tileId, seeTileIds.exact);
    for (const key of ["enter", "tab"] as const) {
      assert.equal(decideCandidateCommit(visible, "see", key)?.tileDef.tileId, seeTileIds.exact);
    }
  });

  test("orders matches exact, prefix, substring, then bag, breaking ties by oracle order", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const visible = filterStripCandidates(candidates, "see");

    assert.deepEqual(seeCollisionOrder(visible), [
      seeTileIds.exact,
      seeTileIds.prefixFirst,
      seeTileIds.prefixSecond,
      seeTileIds.substring,
      seeTileIds.fuzzy,
    ]);
  });

  test("an empty filter keeps the oracle's order", () => {
    const { candidates } = offeringForEmptyWhenSide();

    assert.deepEqual(
      filterStripCandidates(candidates, "").map((c) => c.key),
      candidates.map((c) => c.key)
    );
  });
});

describe("decideCandidateCommit", () => {
  const visible = [
    candidate(notTileId, "not"),
    candidate(negTileId, "negate"),
    candidate(numberVarFactoryId, "number"),
  ];

  test("Enter and Tab commit the top match", () => {
    for (const key of ["enter", "tab"] as const) {
      assert.equal(decideCandidateCommit(visible, "n", key)?.label, "not");
    }
  });

  test("Space commits an exact label match even when longer labels share the prefix", () => {
    assert.equal(decideCandidateCommit(visible, "not", "space")?.label, "not");
  });

  test("Space commits a unique prefix match", () => {
    assert.equal(decideCandidateCommit(visible, "neg", "space")?.label, "negate");
  });

  test("Space does not commit an ambiguous prefix", () => {
    assert.equal(decideCandidateCommit(visible, "n", "space"), undefined);
  });

  test("no key commits an empty filter", () => {
    for (const key of ["enter", "tab", "space"] as const) {
      assert.equal(decideCandidateCommit(visible, "", key), undefined);
      assert.equal(decideCandidateCommit(visible, "   ", key), undefined);
    }
  });

  test("no key commits when the text matches no candidate", () => {
    for (const key of ["enter", "tab", "space"] as const) {
      assert.equal(decideCandidateCommit([], "zzz", key), undefined);
    }
  });
});

describe("isUnknownFilterText", () => {
  test("text matching no candidate is unknown", () => {
    assert.equal(isUnknownFilterText([], "zzz"), true);
  });

  test("empty text and matched text are not unknown", () => {
    assert.equal(isUnknownFilterText([], ""), false);
    assert.equal(isUnknownFilterText([candidate(notTileId, "not")], "not"), false);
  });
});

describe("mintNumberLiteralCandidate", () => {
  test("typed digits mint a number literal candidate carrying the typed value", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const minted = mintNumberLiteralCandidate(candidates, "42", (tileDef) => tileDef.tileId);

    assert.ok(minted, "the empty WHEN side accepts a numeric literal");
    assert.equal(minted.tileDef.kind, "literal");
    assert.equal((minted.tileDef as BrainTileLiteralDef).valueType, CoreTypeIds.Number);
    assert.equal((minted.tileDef as BrainTileLiteralDef).value, 42);
    assert.equal(minted.origin.kind, "minted-literal");
    if (minted.origin.kind === "minted-literal") {
      assert.equal(minted.origin.value, 42);
      assert.equal(minted.origin.factoryTileDef.tileId, numberLiteralFactoryId);
    }
  });

  test("mints for negative and fractional numbers, not for other text", () => {
    const { candidates } = offeringForEmptyWhenSide();
    const label = (tileDef: IBrainTileDef) => tileDef.tileId;

    assert.ok(mintNumberLiteralCandidate(candidates, "-7", label));
    assert.ok(mintNumberLiteralCandidate(candidates, "1.5", label));
    assert.equal(mintNumberLiteralCandidate(candidates, "12abc", label), undefined);
    assert.equal(mintNumberLiteralCandidate(candidates, "", label), undefined);
  });

  test("mints nothing when the position offers no number literal factory", () => {
    const withoutFactory = [candidate(notTileId, "not")];
    assert.equal(
      mintNumberLiteralCandidate(withoutFactory, "42", (tileDef) => tileDef.tileId),
      undefined
    );
  });

  test("committing the minted candidate registers the same literal tile the manufacture path produces", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const minted = mintNumberLiteralCandidate(candidates, "42", (tileDef) => tileDef.tileId);
    assert.ok(minted && minted.origin.kind === "minted-literal");

    const placed = manufactureLiteralTile(minted.origin.factoryTileDef, brain.catalog(), minted.origin.value);

    assert.ok(placed);
    assert.equal(placed.tileId, minted.tileDef.tileId);
    assert.equal(brain.catalog().get(placed.tileId), placed, "the placed literal is registered in the brain catalog");
    const again = manufactureLiteralTile(minted.origin.factoryTileDef, brain.catalog(), minted.origin.value);
    assert.equal(again, placed, "a second placement reuses the registered literal");
  });

  test("a trailing s mints the value in the time-seconds format", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    const minted = mintNumberLiteralCandidate(candidates, "0.5s", labelOf);

    assert.ok(minted && minted.origin.kind === "minted-literal");
    assert.equal((minted.tileDef as BrainTileLiteralDef).value, 0.5);
    assert.equal((minted.tileDef as BrainTileLiteralDef).displayFormat, LiteralDisplayFormats.TimeSeconds);
    assert.equal(minted.origin.displayFormat, LiteralDisplayFormats.TimeSeconds);
    assert.equal(minted.label, "0.5s", "the chip reads the formatted value, not the digits alone");
  });

  test("a trailing ms mints the value its milliseconds reading names", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    const minted = mintNumberLiteralCandidate(candidates, "500ms", labelOf);

    assert.ok(minted && minted.origin.kind === "minted-literal");
    assert.equal((minted.tileDef as BrainTileLiteralDef).value, 0.5);
    assert.equal((minted.tileDef as BrainTileLiteralDef).displayFormat, LiteralDisplayFormats.TimeMs);
    assert.equal(minted.label, "500ms");
  });

  test("a trailing percent sign mints the fraction its percent reading names", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    const minted = mintNumberLiteralCandidate(candidates, "50%", labelOf);

    assert.ok(minted && minted.origin.kind === "minted-literal");
    assert.equal((minted.tileDef as BrainTileLiteralDef).value, 0.5);
    assert.equal(minted.origin.displayFormat, percentFormat(0));
    assert.equal(minted.label, "50%");
  });

  test("the typed digits carry their own precision into the percent format", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    const minted = mintNumberLiteralCandidate(candidates, "12.5%", labelOf);

    assert.ok(minted && minted.origin.kind === "minted-literal");
    assert.equal((minted.tileDef as BrainTileLiteralDef).value, 0.125);
    assert.equal(minted.origin.displayFormat, percentFormat(1));
    assert.equal(minted.label, "12.5%");
  });

  test("digits with no specifier mint in the default format", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();

    const minted = mintNumberLiteralCandidate(candidates, "42", sentenceLabel(brain));

    assert.ok(minted && minted.origin.kind === "minted-literal");
    assert.equal(minted.origin.displayFormat, LiteralDisplayFormats.Default);
    assert.equal((minted.tileDef as BrainTileLiteralDef).displayFormat, LiteralDisplayFormats.Default);
  });

  test("mints nothing for trailing text that is not a format specifier", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    for (const typed of ["5x", "5S", "5 s", "5%%", "5m", "5sec"]) {
      assert.equal(mintNumberLiteralCandidate(candidates, typed, labelOf), undefined, typed);
    }
  });

  test("mints nothing for a specifier with no number in front of it", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    for (const typed of ["s", "ms", "%"]) {
      assert.equal(mintNumberLiteralCandidate(candidates, typed, labelOf), undefined, typed);
    }
  });

  test("mints nothing while the number is still being typed", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    assert.equal(mintNumberLiteralCandidate(candidates, "1.", labelOf), undefined);
    assert.equal(mintNumberLiteralCandidate(candidates, "-", labelOf), undefined);
  });
});

describe("mintTextLiteralCandidate", () => {
  test("the empty WHEN side accepts a text literal, and a position of bare operators does not", () => {
    const { candidates } = offeringForEmptyWhenSide();

    assert.equal(offersTextLiteral(candidates), true);
    assert.equal(offersTextLiteral([candidate(notTileId, "not")]), false);
  });

  test("a text literal reached only through a conversion is no text literal position", () => {
    const converted = [conversionCandidate(stringLiteralFactoryId, "create a text tile")];

    assert.equal(offersTextLiteral(converted), false);
    assert.equal(
      mintTextLiteralCandidate(converted, "hi", (tileDef) => tileDef.tileId),
      undefined
    );
  });

  test("a typed text value mints a literal carrying the value verbatim", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();

    const minted = mintTextLiteralCandidate(candidates, "hello world. ok", sentenceLabel(brain));

    assert.ok(minted && minted.origin.kind === "minted-literal");
    assert.equal(minted.tileDef.kind, "literal");
    assert.equal((minted.tileDef as BrainTileLiteralDef).valueType, CoreTypeIds.String);
    assert.equal((minted.tileDef as BrainTileLiteralDef).value, "hello world. ok");
    assert.equal(minted.origin.value, "hello world. ok");
    assert.equal(minted.origin.displayFormat, LiteralDisplayFormats.Default);
    assert.equal(minted.group, "literal");
  });

  test("the empty value mints its own literal", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();

    const minted = mintTextLiteralCandidate(candidates, "", sentenceLabel(brain));

    assert.ok(minted && minted.origin.kind === "minted-literal");
    assert.equal((minted.tileDef as BrainTileLiteralDef).value, "");
  });

  test("mints nothing where the position offers no text literal factory", () => {
    assert.equal(
      mintTextLiteralCandidate([candidate(notTileId, "not")], "hi", (tileDef) => tileDef.tileId),
      undefined
    );
  });

  test("each distinct value registers its own tile, and a repeated value reuses the registered one", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);
    const first = mintTextLiteralCandidate(candidates, "go left", labelOf);
    const second = mintTextLiteralCandidate(candidates, "go right", labelOf);
    assert.ok(first && first.origin.kind === "minted-literal");
    assert.ok(second && second.origin.kind === "minted-literal");

    const placedFirst = manufactureLiteralTile(
      first.origin.factoryTileDef,
      brain.catalog(),
      first.origin.value,
      first.origin.displayFormat
    );
    const placedSecond = manufactureLiteralTile(
      second.origin.factoryTileDef,
      brain.catalog(),
      second.origin.value,
      second.origin.displayFormat
    );

    assert.ok(placedFirst && placedSecond);
    assert.notEqual(placedFirst.tileId, placedSecond.tileId, "distinct values are distinct tiles");
    assert.equal(placedFirst.tileId, first.tileDef.tileId, "the placed tile is the one the chip previewed");
    assert.equal(brain.catalog().get(placedFirst.tileId), placedFirst);
    const again = manufactureLiteralTile(
      first.origin.factoryTileDef,
      brain.catalog(),
      first.origin.value,
      first.origin.displayFormat
    );
    assert.equal(again, placedFirst, "the same value reuses the registered literal");
  });
});

describe("a formatted literal the composer types", () => {
  /**
   * Mint the literal `typed` names and place it through the manufacture seam the
   * strip commits through, returning the placed tile and the word its sentence
   * reads it as.
   */
  function placeTypedLiteral(typed: string) {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);
    const minted = mintNumberLiteralCandidate(candidates, typed, labelOf);
    assert.ok(minted && minted.origin.kind === "minted-literal", `${typed} mints a literal`);
    const placed = manufactureLiteralTile(
      minted.origin.factoryTileDef,
      brain.catalog(),
      minted.origin.value,
      minted.origin.displayFormat
    );
    assert.ok(placed);
    return { brain, labelOf, minted, origin: minted.origin, placed };
  }

  test("the placed literal reads back as the text that minted it", () => {
    for (const typed of ["0.5s", "500ms", "50%", "7%", "12.5%", "42"]) {
      const { labelOf, placed } = placeTypedLiteral(typed);
      assert.equal(labelOf(placed), typed, `${typed} round trips through its display format`);
    }
  });

  test("a typed percent places the fraction it reads as", () => {
    const { placed, labelOf } = placeTypedLiteral("50%");

    assert.equal(placed.value, 0.5);
    assert.equal(labelOf(placed), "50%");
  });

  test("the placed tile is the one the candidate previewed, and a second placement reuses it", () => {
    const { brain, origin, minted, placed } = placeTypedLiteral("0.5s");

    assert.equal(placed.tileId, minted.tileDef.tileId);
    assert.equal(brain.catalog().get(placed.tileId), placed);
    const again = manufactureLiteralTile(origin.factoryTileDef, brain.catalog(), origin.value, origin.displayFormat);
    assert.equal(again, placed, "the same value and format reuse the registered literal");
  });

  test("the same value in another format is another tile", () => {
    const { brain, origin, placed } = placeTypedLiteral("0.5s");

    const plain = manufactureLiteralTile(origin.factoryTileDef, brain.catalog(), origin.value);

    assert.ok(plain);
    assert.notEqual(plain.tileId, placed.tileId);
    assert.equal(plain.value, placed.value);
  });
});

/** The types the variable factories in `candidates` produce, in offering order. */
function acceptedVariableTypes(candidates: readonly StripCandidate[]): TypeId[] {
  return candidates
    .filter((c) => c.tileDef.kind === "factory" && isVariableFactoryTileId(c.tileDef.tileId))
    .map((c) => (c.tileDef as BrainTileFactoryDef).producedDataType as TypeId);
}

/** The variable type each minted candidate would place, in offering order. */
function mintedVariableTypes(candidates: readonly StripCandidate[]): TypeId[] {
  return candidates.map((c) => (c.tileDef as BrainTileVariableDef).varType);
}

/** The candidates minted as new variables, in offering order. */
function mintedVariables(candidates: readonly StripCandidate[]): StripCandidate[] {
  return candidates.filter((c) => c.origin.kind === "minted-variable");
}

/**
 * The oracle's offering for the empty WHEN side of a fresh brain, with a number
 * variable per name in `names` registered through the same manufacture seam the
 * strip mints through.
 */
function offeringWithNumberVariables(...names: string[]) {
  return offeringForEmptySide(RuleSide.When, {
    prepare: (brain) => {
      for (const name of names) {
        manufactureVariableTile(coreTile(numberVarFactoryId) as BrainTileFactoryDef, brain.catalog(), name);
      }
    },
  });
}

describe("parseStripFilter", () => {
  test("plain filter text declares no variable intent and filters by the whole text", () => {
    assert.deepEqual(parseStripFilter("speedy"), { variableIntent: false, text: "speedy" });
    assert.deepEqual(parseStripFilter("  speedy  "), { variableIntent: false, text: "speedy" });
    assert.deepEqual(parseStripFilter(""), { variableIntent: false, text: "" });
  });

  test("a leading $ declares variable intent and filters by the remainder", () => {
    assert.deepEqual(parseStripFilter("$speedy"), { variableIntent: true, text: "speedy" });
    assert.deepEqual(parseStripFilter("  $ speedy "), { variableIntent: true, text: "speedy" });
  });

  test("$ alone declares variable intent with no name yet", () => {
    assert.deepEqual(parseStripFilter("$"), { variableIntent: true, text: "" });
  });
});

describe("mintVariableCandidates", () => {
  test("mints one candidate per type the position accepts, each named by the typed text", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const mints = mintVariableCandidates(candidates, "speedy", stripLabel);

    assert.ok(mints.length > 0, "the empty WHEN side accepts a variable");
    assert.deepEqual(mintedVariableTypes(mints), acceptedVariableTypes(candidates));
    for (const mint of mints) {
      assert.equal(mint.tileDef.kind, "variable");
      assert.equal((mint.tileDef as BrainTileVariableDef).varName, "speedy");
      assert.equal(mint.label, "speedy");
      assert.equal(mint.group, "variable");
      assert.equal(mint.origin.kind, "minted-variable");
      if (mint.origin.kind === "minted-variable") assert.equal(mint.origin.varName, "speedy");
    }
  });

  test("the minted type is the type the armed position expects", () => {
    const { candidates } = offeringForEmptySide(RuleSide.When, { expectedType: CoreTypeIds.Number });

    const mints = mintVariableCandidates(candidates, "speedy", stripLabel);

    assert.deepEqual(
      mintedVariableTypes(mints.filter((mint) => !mint.viaConversion)),
      [CoreTypeIds.Number],
      "a number position mints a number variable directly"
    );
    assert.deepEqual(mintedVariableTypes(mints), acceptedVariableTypes(candidates), "no type beyond the accepted set");
  });

  test("mints nothing when the position accepts no variable", () => {
    assert.deepEqual(mintVariableCandidates([candidate(notTileId, "not")], "speedy", stripLabel), []);
  });

  test("mints nothing for a name the create-variable path would reject", () => {
    const { candidates } = offeringForEmptyWhenSide();

    assert.deepEqual(mintVariableCandidates(candidates, "", stripLabel), []);
    assert.deepEqual(mintVariableCandidates(candidates, "   ", stripLabel), []);
  });

  test("mints nothing at a type that already holds a variable of that name", () => {
    const { candidates } = offeringWithNumberVariables("speedy");

    const mints = mintVariableCandidates(candidates, "speedy", stripLabel);

    assert.ok(!mintedVariableTypes(mints).includes(CoreTypeIds.Number), "the existing number variable is the answer");
    assert.ok(mints.length > 0, "the other accepted types still mint");
  });

  test("keys are stable across calls for the same name and position", () => {
    const { candidates } = offeringForEmptyWhenSide();

    assert.deepEqual(
      mintVariableCandidates(candidates, "speedy", stripLabel).map((c) => c.key),
      mintVariableCandidates(candidates, "speedy", stripLabel).map((c) => c.key)
    );
  });

  test("every minted key is distinct", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const keys = mintVariableCandidates(candidates, "speedy", stripLabel).map((c) => c.key);

    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("resolveStripOffering", () => {
  test("an unknown word at a variable-accepting position offers a mint and stays unknown", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const offering = resolveStripOffering(candidates, "speedy", stripLabel);

    assert.ok(mintedVariables(offering.visible).length > 0, "the unknown word offers a mint");
    assert.equal(offering.isUnknown, true, "the amber unknown state stands alongside the mint");
    assert.ok(
      offering.offered.some((c) => c.origin.kind === "minted-variable"),
      "the mint is part of the offering, not only of the filtered view"
    );
  });

  test("no commit key places a plain unknown word, mint entries present", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const offering = resolveStripOffering(candidates, "speedy", stripLabel);

    assert.ok(mintedVariables(offering.visible).length > 0);
    for (const key of ["enter", "tab", "space"] as const) {
      assert.equal(decideCandidateCommit(offering.visible, "speedy", key), undefined);
    }
  });

  test("$ scopes the offering to existing variables and the mint", () => {
    const { candidates } = offeringWithNumberVariables("speedy");

    const offering = resolveStripOffering(candidates, "$", stripLabel);

    assert.deepEqual(
      offering.visible.map((c) => c.tileDef.kind),
      offering.visible.map(() => "variable"),
      "only variables are in scope"
    );
    assert.deepEqual(
      offering.visible.map((c) => c.label),
      ["speedy"],
      "an empty name offers the existing variables and mints nothing"
    );
    assert.equal(offering.isUnknown, false);
  });

  test("$ filters the existing variables by the remainder", () => {
    const { candidates } = offeringWithNumberVariables("speedy", "heading");

    const offering = resolveStripOffering(candidates, "$head", stripLabel);

    assert.deepEqual(
      offering.visible.filter((c) => c.origin.kind === "suggested").map((c) => c.label),
      ["heading"]
    );
  });

  test("$ with an unmatched name mints it on Enter", () => {
    const { candidates } = offeringWithNumberVariables("speedy");

    const offering = resolveStripOffering(candidates, "$turbo", stripLabel);
    const placed = decideCandidateCommit(offering.visible, "$turbo", "enter");

    assert.ok(placed, "declared variable intent commits the mint");
    assert.equal(placed.origin.kind, "minted-variable");
    assert.equal((placed.tileDef as BrainTileVariableDef).varName, "turbo");
    assert.equal(offering.isUnknown, false, "a committable mint is not unknown text");
  });

  test("$ with an exactly matching name commits that variable rather than minting", () => {
    const { candidates } = offeringWithNumberVariables("speedy");

    const offering = resolveStripOffering(candidates, "$speedy", stripLabel);
    const placed = decideCandidateCommit(offering.visible, "$speedy", "enter");

    assert.ok(placed);
    assert.equal(placed.origin.kind, "suggested");
    assert.equal((placed.tileDef as BrainTileVariableDef).varName, "speedy");
  });

  test("$ with a name that prefixes an existing variable ranks the mint after the match", () => {
    const { candidates } = offeringWithNumberVariables("speedy");

    const offering = resolveStripOffering(candidates, "$spee", stripLabel);

    const origins = offering.visible.map((c) => c.origin.kind);
    assert.ok(origins.includes("minted-variable"), "the short name is never suppressed");
    assert.ok(
      origins.indexOf("suggested") < origins.indexOf("minted-variable"),
      "the existing match is the likelier intent"
    );
    assert.equal(decideCandidateCommit(offering.visible, "$spee", "enter")?.origin.kind, "suggested");
  });

  test("$ with a name the create-variable path would reject is unknown", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const offering = resolveStripOffering(candidates, "$", stripLabel);

    assert.deepEqual(offering.visible, [], "a fresh brain holds no variable to offer");
    assert.equal(offering.isUnknown, true);
  });

  test("typed digits still mint a literal, ahead of the offering and never unknown", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const offering = resolveStripOffering(candidates, "42", stripLabel);

    assert.equal(offering.visible[0].origin.kind, "minted-literal");
    assert.equal((offering.visible[0].tileDef as BrainTileLiteralDef).value, 42);
    assert.equal(offering.isUnknown, false);
    assert.deepEqual(mintedVariables(offering.visible), [], "a complete number is not an unknown word");
    assert.equal(decideCandidateCommit(offering.visible, "42", "enter")?.origin.kind, "minted-literal");
  });

  test("a matched word offers no mint", () => {
    const { candidates } = offeringForEmptyWhenSide();
    const known = candidates[0].label;

    const offering = resolveStripOffering(candidates, known, stripLabel);

    assert.deepEqual(mintedVariables(offering.visible), []);
    assert.equal(offering.isUnknown, false);
  });

  test("a typed format specifier mints its literal, ahead of the offering and never unknown", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    for (const [typed, format] of [
      ["0.5s", LiteralDisplayFormats.TimeSeconds],
      ["500ms", LiteralDisplayFormats.TimeMs],
      ["50%", percentFormat(0)],
    ] as const) {
      const offering = resolveStripOffering(candidates, typed, labelOf);

      assert.equal(offering.visible[0]?.origin.kind, "minted-literal", typed);
      assert.equal((offering.visible[0].tileDef as BrainTileLiteralDef).displayFormat, format, typed);
      assert.equal(offering.isUnknown, false, typed);
      assert.deepEqual(mintedVariables(offering.visible), [], typed);
      assert.equal(decideCandidateCommit(offering.visible, typed, "enter")?.origin.kind, "minted-literal", typed);
      assert.equal(decideCandidateCommit(offering.visible, typed, "space")?.origin.kind, "minted-literal", typed);
    }
  });

  test("trailing text that is not a format specifier stays unknown", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    const offering = resolveStripOffering(candidates, "5x", labelOf);

    assert.equal(offering.isUnknown, true);
    assert.deepEqual(
      offering.visible.filter((c) => c.origin.kind === "minted-literal"),
      []
    );
    for (const key of ["enter", "tab", "space"] as const) {
      assert.equal(decideCandidateCommit(offering.visible, "5x", key)?.origin.kind, undefined);
    }
  });

  test("minted variables render in their own presentation, suggestions in the seated one", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const entries = toCandidateEntries(resolveStripOffering(candidates, "speedy", stripLabel).visible);

    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.equal(entry.presentation, entry.candidate.origin.kind === "minted-variable" ? "minting" : "seated");
    }
  });
});

describe("a number the composer is partway through typing", () => {
  const inProgress = ["1.", "-2.", "-"];

  test("is neither matched nor unknown, so nothing reads as amber", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    for (const typed of inProgress) {
      const offering = resolveStripOffering(candidates, typed, labelOf);

      assert.equal(offering.isUnknown, false, typed);
      assert.deepEqual(offering.visible, [], typed);
    }
  });

  test("offers no variable to mint", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    for (const typed of inProgress) {
      const offering = resolveStripOffering(candidates, typed, labelOf);

      assert.deepEqual(mintedVariables(offering.offered), [], typed);
    }
  });

  test("commits nothing on any commit key", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    for (const typed of inProgress) {
      const offering = resolveStripOffering(candidates, typed, labelOf);

      for (const key of ["enter", "tab", "space"] as const) {
        assert.equal(decideCandidateCommit(offering.visible, typed, key), undefined, `${typed} ${key}`);
      }
    }
  });

  test("the next digit brings the literal back", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const labelOf = sentenceLabel(brain);

    const offering = resolveStripOffering(candidates, "1.5", labelOf);

    assert.equal(offering.visible[0]?.origin.kind, "minted-literal");
    assert.equal((offering.visible[0].tileDef as BrainTileLiteralDef).value, 1.5);
    assert.equal(offering.isUnknown, false);
  });

  test("stays unknown where the position accepts no number at all", () => {
    const withoutFactory = [candidate(notTileId, "not")];

    const offering = resolveStripOffering(withoutFactory, "1.", stripLabel);

    assert.equal(offering.isUnknown, true, "text that can never resolve is still unknown");
    assert.deepEqual(offering.visible, []);
  });
});

describe("manufactureVariableTile", () => {
  test("committing a minted variable registers the tile the create-variable path produces", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();
    const minted = mintVariableCandidates(candidates, "speedy", stripLabel)[0];
    assert.ok(minted && minted.origin.kind === "minted-variable");

    const placed = manufactureVariableTile(minted.origin.factoryTileDef, brain.catalog(), minted.origin.varName);

    assert.ok(placed);
    assert.equal(placed.kind, "variable");
    assert.equal(placed.varName, "speedy");
    assert.equal(placed.varType, (minted.tileDef as BrainTileVariableDef).varType);
    assert.equal(brain.catalog().get(placed.tileId), placed, "the placed variable is registered in the brain catalog");
    const again = manufactureVariableTile(minted.origin.factoryTileDef, brain.catalog(), minted.origin.varName);
    assert.equal(again, placed, "a second placement reuses the registered variable");
  });
});

describe("identityCandidateRanker", () => {
  test("preserves the oracle's candidate order", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const ranked = identityCandidateRanker(candidates, null);

    assert.deepEqual(
      ranked.map((c) => c.key),
      candidates.map((c) => c.key)
    );
  });
});

describe("categoryPriorityCandidateRanker", () => {
  /** The leading run of the ranked offering that the strip shows as the best-next row. */
  function bestNextOf(candidates: readonly StripCandidate[], target: ArmedTileTarget): StripCandidate[] {
    return [...categoryPriorityCandidateRanker(candidates, target)].slice(0, kBestNextCandidateCount);
  }

  test("sensors fill the best-next row on an empty WHEN side", () => {
    const { candidates, target } = offeringForEmptySide(RuleSide.When);

    const bestNext = bestNextOf(candidates, target);

    assert.equal(bestNext.length, kBestNextCandidateCount);
    assert.deepEqual(
      bestNext.filter((c) => c.group !== "sensor").map((c) => c.tileDef.tileId),
      []
    );
  });

  test("the bare structural and create-variable tiles leave the best-next row but stay in the offering", () => {
    const { candidates, target } = offeringForEmptySide(RuleSide.When);

    const ranked = categoryPriorityCandidateRanker(candidates, target);

    const bestNextIds = new Set(ranked.slice(0, kBestNextCandidateCount).map((c) => c.tileDef.tileId));
    const offeredIds = new Set(ranked.map((c) => c.tileDef.tileId));
    for (const tileId of demotedTileIds) {
      assert.equal(bestNextIds.has(tileId), false, tileId);
      assert.equal(offeredIds.has(tileId), true, tileId);
    }
    assert.equal(ranked.length, candidates.length);
  });

  test("actuators lead the offering on an empty DO side", () => {
    const { candidates, target } = offeringForEmptySide(RuleSide.Do);

    const ranked = categoryPriorityCandidateRanker(candidates, target);

    const actuatorCount = candidates.filter((c) => c.group === "actuator").length;
    assert.ok(actuatorCount >= rankingActuatorTileIds.length);
    assert.deepEqual(
      ranked.slice(0, actuatorCount).map((c) => c.group),
      candidates.filter((c) => c.group === "actuator").map((c) => c.group)
    );
    for (const tileId of rankingActuatorTileIds) {
      assert.ok(
        ranked.slice(0, actuatorCount).some((c) => c.tileDef.tileId === tileId),
        tileId
      );
    }
  });

  test("every concrete content tile ranks ahead of every structural and create-variable tile", () => {
    for (const side of [RuleSide.When, RuleSide.Do]) {
      const { candidates, target } = offeringForEmptySide(side);

      const ranked = categoryPriorityCandidateRanker(candidates, target);

      const demoted = new Set(demotedTileIds);
      const lastContentIndex = ranked.reduce((last, c, index) => (demoted.has(c.tileDef.tileId) ? last : index), -1);
      const firstDemotedIndex = ranked.findIndex((c) => demoted.has(c.tileDef.tileId));
      assert.ok(firstDemotedIndex >= 0, "the offering includes structural or create-variable tiles");
      assert.ok(firstDemotedIndex > lastContentIndex, `side ${side}`);
    }
  });

  test("keeps the oracle's relative order inside a band", () => {
    const { candidates, target } = offeringForEmptySide(RuleSide.When);

    const ranked = categoryPriorityCandidateRanker(candidates, target, provenanceContext);

    assert.deepEqual(seeCollisionOrder(ranked), seeCollisionOrder(candidates));
    for (const band of ["application", "library", "core"] as const) {
      const inBand = (list: readonly StripCandidate[]) =>
        list
          .filter((c) => c.group === "sensor" && candidateProvenanceBand(c.tileDef, provenanceContext) === band)
          .map((c) => c.key);
      assert.ok(inBand(candidates).length > 0, band);
      assert.deepEqual(inBand(ranked), inBand(candidates), band);
    }
  });

  test("ranks the same offering identically on every call", () => {
    const { candidates, target } = offeringForEmptySide(RuleSide.When);

    const first = categoryPriorityCandidateRanker(candidates, target, provenanceContext);
    const second = categoryPriorityCandidateRanker(candidates, target, provenanceContext);

    assert.deepEqual(
      first.map((c) => c.key),
      second.map((c) => c.key)
    );
  });

  test("demotes structural and create-variable tiles with no armed target", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const ranked = categoryPriorityCandidateRanker(candidates, null);

    const demoted = new Set(demotedTileIds);
    const firstDemotedIndex = ranked.findIndex((c) => demoted.has(c.tileDef.tileId));
    const lastContentIndex = ranked.reduce((last, c, index) => (demoted.has(c.tileDef.tileId) ? last : index), -1);
    assert.ok(firstDemotedIndex > lastContentIndex);
  });
});

describe("categoryPriorityCandidateRanker provenance", () => {
  /**
   * Position of each tile id in the ranked offering for the empty WHEN side,
   * resolved against `context`.
   */
  function rankAt(context: CandidateProvenanceContext): (tileId: string) => number {
    const { candidates, target } = offeringForEmptySide(RuleSide.When);
    const order = categoryPriorityCandidateRanker(candidates, target, context).map((c) => c.tileDef.tileId);
    return (tileId: string) => {
      const index = order.indexOf(tileId);
      assert.ok(index >= 0, `absent from the offering: ${tileId}`);
      return index;
    };
  }

  test("application-level sensors lead the core built-in sensors", () => {
    const rank = rankAt(provenanceContext);

    assert.ok(rank(seeTileIds.exact) < rank(onPageEnteredTileId));
    assert.ok(rank(seeTileIds.exact) < rank(timeoutTileId));
    assert.ok(rank(provenanceSensorTileIds.platform) < rank(onPageEnteredTileId));
  });

  test("the project's own compiled tiles band with the platform's own tiles", () => {
    const rank = rankAt(provenanceContext);

    assert.ok(rank(provenanceSensorTileIds.project) < rank(provenanceSensorTileIds.library));
    assert.ok(rank(provenanceSensorTileIds.platform) < rank(provenanceSensorTileIds.library));
  });

  test("library tiles rank behind application tiles and ahead of core built-ins", () => {
    const rank = rankAt(provenanceContext);

    assert.ok(rank(seeTileIds.exact) < rank(provenanceSensorTileIds.library));
    assert.ok(rank(provenanceSensorTileIds.library) < rank(onPageEnteredTileId));
    assert.ok(rank(provenanceSensorTileIds.library) < rank(timeoutTileId));
  });

  test("a core built-in sensor still leads an application tile of a lower tier", () => {
    const rank = rankAt(provenanceContext);

    assert.equal(candidateProvenanceBand(coreTile(platformInlineSensorTileId), provenanceContext), "application");
    assert.ok(rank(onPageEnteredTileId) < rank(platformInlineSensorTileId));
    assert.ok(rank(timeoutTileId) < rank(platformInlineSensorTileId));
  });

  test("without a project namespace, compiled and platform tiles still lead core built-ins", () => {
    const rank = rankAt({});

    assert.ok(rank(provenanceSensorTileIds.platform) < rank(onPageEnteredTileId));
    assert.ok(rank(provenanceSensorTileIds.project) < rank(onPageEnteredTileId));
    assert.ok(rank(provenanceSensorTileIds.library) < rank(onPageEnteredTileId));
  });

  test("bands each tile by its defining layer", () => {
    assert.equal(candidateProvenanceBand(coreTile(onPageEnteredTileId), provenanceContext), "core");
    assert.equal(candidateProvenanceBand(coreTile(switchPageTileId), provenanceContext), "core");
    assert.equal(candidateProvenanceBand(coreTile(notTileId), provenanceContext), "core");
    assert.equal(candidateProvenanceBand(coreTile(numberVarFactoryId), provenanceContext), "core");
    assert.equal(candidateProvenanceBand(coreTile(seeTileIds.exact), provenanceContext), "application");
    assert.equal(candidateProvenanceBand(coreTile(provenanceSensorTileIds.project), provenanceContext), "application");
    assert.equal(candidateProvenanceBand(coreTile(provenanceSensorTileIds.library), provenanceContext), "library");
  });
});

describe("groupStripCandidates", () => {
  test("a group's conversion candidates join the group's own section", () => {
    const direct = candidate(notTileId, "not");
    const converted = conversionCandidate(negTileId, "negate");
    assert.equal(tileCandidateGroup(direct.tileDef), tileCandidateGroup(converted.tileDef));

    const sections = groupStripCandidates([direct, converted]);

    assert.equal(sections.length, 1);
    assert.deepEqual(
      sections[0].candidates.map((c) => c.key),
      [direct.key, converted.key]
    );
  });

  test("every section is keyed by the group it holds, conversions included", () => {
    const converted = conversionCandidate(negTileId, "negate");
    const sections = groupStripCandidates([candidate(timeoutTileId, "timeout"), converted]);

    assert.equal(sections.length, 2);
    for (const section of sections) assert.equal(section.key, section.group);
    assert.equal(new Set(sections.map((section) => section.key)).size, sections.length);
  });
});

describe("arrangeCandidateSubcategories", () => {
  /** The provenance probes as candidates, keyed by the layer each stands in for. */
  function probe(layer: ProvenanceProbe, label: string): StripCandidate {
    return candidate(provenanceSensorTileIds[layer], label);
  }

  test("a mixed section leads with the application chips, then each library, then core", () => {
    const clusters = arrangeCandidateSubcategories(
      toCandidateEntries([
        candidate(onPageEnteredTileId, "page entered"),
        probe("library", "scan"),
        probe("libraryAlt", "ping"),
        probe("project", "sniff"),
        probe("platform", "listen"),
        candidate(timeoutTileId, "timeout"),
      ]),
      provenanceContext,
      installedLibraries
    );

    assert.deepEqual(
      clusters.map((cluster) => cluster.band),
      ["application", "library", "library", "core"]
    );
    assert.deepEqual(
      clusters.slice(1, 3).map((cluster) => cluster.heading),
      [kSecondLibraryName, kLibraryName]
    );
    assert.equal(new Set(clusters.map((cluster) => cluster.key)).size, clusters.length);
    assert.deepEqual(
      clusters[0].entries.map((entry) => entry.candidate.tileDef.tileId),
      [provenanceSensorTileIds.project, provenanceSensorTileIds.platform]
    );
    assert.deepEqual(
      clusters[3].entries.map((entry) => entry.candidate.tileDef.tileId),
      [onPageEnteredTileId, timeoutTileId]
    );
  });

  test("a section of one provenance arranges into a single cluster", () => {
    const clusters = arrangeCandidateSubcategories(
      toCandidateEntries([candidate(onPageEnteredTileId, "page entered"), candidate(timeoutTileId, "timeout")]),
      provenanceContext,
      installedLibraries
    );

    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].band, "core");
  });

  test("conversion chips follow the direct chips of their own subcategory", () => {
    const clusters = arrangeCandidateSubcategories(
      toCandidateEntries([
        conversionCandidate(provenanceSensorTileIds.library, "scan"),
        conversionCandidate(onPageEnteredTileId, "page entered"),
        probe("platform", "listen"),
        candidate(timeoutTileId, "timeout"),
        probe("library", "scan"),
      ]),
      provenanceContext,
      installedLibraries
    );

    assert.deepEqual(
      clusters.map((cluster) => cluster.band),
      ["application", "library", "core"]
    );
    for (const cluster of clusters) {
      const converted = cluster.entries.map((entry) => entry.candidate.viaConversion);
      assert.deepEqual(
        converted,
        [...converted].sort((a, b) => Number(a) - Number(b)),
        cluster.key
      );
    }
    assert.deepEqual(
      clusters[1].entries.map((entry) => entry.candidate.viaConversion),
      [false, true]
    );
    assert.deepEqual(
      clusters[2].entries.map((entry) => entry.candidate.viaConversion),
      [false, true]
    );
  });

  test("a subcategory whose chips the filter removed is absent from the arrangement", () => {
    const clusters = arrangeCandidateSubcategories(
      toCandidateEntries([probe("platform", "listen"), candidate(timeoutTileId, "timeout")]),
      provenanceContext,
      installedLibraries
    );

    assert.deepEqual(
      clusters.map((cluster) => cluster.band),
      ["application", "core"]
    );
    assert.deepEqual(arrangeCandidateSubcategories([], provenanceContext, installedLibraries), []);
  });
});

describe("toCandidateEntries", () => {
  test("pairs every candidate with the seated presentation, in order", () => {
    const { candidates } = offeringForEmptyWhenSide();

    const entries = toCandidateEntries(candidates);

    assert.equal(entries.length, candidates.length);
    for (let i = 0; i < entries.length; i++) {
      assert.equal(entries[i].candidate, candidates[i]);
      assert.equal(entries[i].presentation, "seated");
    }
  });
});

describe("an object word whose sentence form opens with an article", () => {
  /**
   * The oracle's offering at the object position after the object sensor,
   * labelled with the word each tile's sentence reads it as -- the label the
   * strip puts on its chips.
   */
  function offeringAfterObjectSensor(): StripCandidate[] {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
    rule.when().appendTile(coreTile(objectSensorTileId));
    const catalogs = List.from<ITileCatalog>([services.edit.tiles, brain.catalog()]).asReadonly();
    const tileSet = rule.when();
    const context = buildInsertionContext({
      side: RuleSide.When,
      expr: tileSet.expr(),
      existingTiles: tileSet.tiles(),
      ruleDef: rule,
    });
    const localizer = brain.servicesLocalizer();
    return buildStripCandidates(suggestTiles(context, catalogs, services), (tileDef) =>
      tileSentenceWord(tileDef, localizer)
    );
  }

  /** The bare noun a user types for the object modifier, which is the tile's own label. */
  function objectNoun(tileId: string): string {
    const noun = coreTile(tileId).metadata?.label;
    assert.ok(noun, "the object modifier carries the noun as its label");
    return noun;
  }

  test("the position offers the object modifiers", () => {
    const offered = offeringAfterObjectSensor().map((c) => c.tileDef.tileId);
    assert.ok(
      offered.includes(articleModifierTileId(articleModifierIds.plant)),
      "the object slot offers the object modifier"
    );
  });

  test("the chip label is the sentence form, which the typed noun does not prefix", () => {
    const offering = offeringAfterObjectSensor();
    const plant = offering.find((c) => c.tileDef.tileId === articleModifierTileId(articleModifierIds.plant));
    assert.ok(plant);
    assert.equal(plant.label.startsWith(objectNoun(articleModifierTileId(articleModifierIds.plant))), false);
  });

  test("the typed noun narrows the offering to that object word", () => {
    const noun = objectNoun(articleModifierTileId(articleModifierIds.plant));
    const visible = filterStripCandidates(offeringAfterObjectSensor(), noun);
    assert.equal(visible[0]?.tileDef.tileId, articleModifierTileId(articleModifierIds.plant));
  });

  test("Space commits the object word typed without its article", () => {
    const noun = objectNoun(articleModifierTileId(articleModifierIds.plant));
    const visible = filterStripCandidates(offeringAfterObjectSensor(), noun);
    assert.equal(
      decideCandidateCommit(visible, noun, "space")?.tileDef.tileId,
      articleModifierTileId(articleModifierIds.plant)
    );
  });

  test("Space still refuses the article the object words share", () => {
    const visible = filterStripCandidates(offeringAfterObjectSensor(), "a");
    assert.equal(decideCandidateCommit(visible, "a", "space"), undefined);
  });
});

describe("operator symbol aliases", () => {
  /** Each symbol the composer reaches an operator by, paired with the tile it places. */
  const aliasTable: readonly (readonly [string, string])[] = [
    ["+", mkOperatorTileId(CoreOpId.Add)],
    ["-", mkOperatorTileId(CoreOpId.Subtract)],
    ["*", mkOperatorTileId(CoreOpId.Multiply)],
    ["/", mkOperatorTileId(CoreOpId.Divide)],
    [">", mkOperatorTileId(CoreOpId.GreaterThan)],
    [">=", mkOperatorTileId(CoreOpId.GreaterThanOrEqualTo)],
    ["<", mkOperatorTileId(CoreOpId.LessThan)],
    ["<=", mkOperatorTileId(CoreOpId.LessThanOrEqualTo)],
    ["==", mkOperatorTileId(CoreOpId.EqualTo)],
    ["!=", mkOperatorTileId(CoreOpId.NotEqualTo)],
    ["=", mkOperatorTileId(CoreOpId.Assign)],
  ];

  const subTileId = mkOperatorTileId(CoreOpId.Subtract);
  const greaterThanTileId = mkOperatorTileId(CoreOpId.GreaterThan);
  const greaterOrEqualTileId = mkOperatorTileId(CoreOpId.GreaterThanOrEqualTo);

  /**
   * The oracle's offering at the position that follows a number operand on
   * `side`, which is where an infix operator is valid. `sentenceWords` labels the
   * candidates with the word each tile's sentence reads it as, rather than the
   * authored label the strip filters by.
   */
  function offeringAfterOperand(
    side: RuleSide,
    seed: "literal" | "variable",
    sentenceWords = false
  ): { candidates: StripCandidate[]; brain: BrainDef } {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
    const tileSet = side === RuleSide.When ? rule.when() : rule.do();
    const operand =
      seed === "literal"
        ? manufactureLiteralTile(coreTile(numberLiteralFactoryId) as BrainTileFactoryDef, brain.catalog(), 1)
        : manufactureVariableTile(coreTile(numberVarFactoryId) as BrainTileFactoryDef, brain.catalog(), "speedy");
    assert.ok(operand, "the operand the operator position follows is placed");
    tileSet.appendTile(operand);
    const catalogs = List.from<ITileCatalog>([services.edit.tiles, brain.catalog()]).asReadonly();
    const context = buildInsertionContext({
      side,
      expr: tileSet.expr(),
      existingTiles: tileSet.tiles(),
      ruleDef: rule,
    });
    const suggested = suggestTiles(context, catalogs, services);
    return { candidates: buildStripCandidates(suggested, sentenceWords ? sentenceLabel(brain) : stripLabel), brain };
  }

  /** The offering `symbol` is typed against: the assignment is a DO-side operator, every other symbol a WHEN-side one. */
  function operatorOffering(symbol: string): StripCandidate[] {
    return symbol === "="
      ? offeringAfterOperand(RuleSide.Do, "variable").candidates
      : offeringAfterOperand(RuleSide.When, "literal").candidates;
  }

  test("every symbol resolves to its operator, ranks exact, and commits on every key", () => {
    for (const [symbol, tileId] of aliasTable) {
      const candidates = operatorOffering(symbol);
      assert.ok(
        candidates.some((c) => c.tileDef.tileId === tileId),
        `${symbol} is typed at a position offering its operator`
      );

      const offering = resolveStripOffering(candidates, symbol, stripLabel);

      assert.equal(offering.visible[0]?.tileDef.tileId, tileId, symbol);
      assert.equal(offering.isUnknown, false, symbol);
      for (const key of ["enter", "tab", "space"] as const) {
        assert.equal(decideCandidateCommit(offering.visible, symbol, key)?.tileDef.tileId, tileId, `${symbol} ${key}`);
      }
    }
  });

  test("the alias never becomes the candidate's word", () => {
    for (const [symbol, tileId] of aliasTable) {
      const offering = resolveStripOffering(operatorOffering(symbol), symbol, stripLabel);
      const placed = offering.visible[0];

      assert.ok(placed, symbol);
      assert.equal(placed.tileDef.tileId, tileId, symbol);
      assert.equal(placed.label, stripLabel(placed.tileDef), `${symbol} keeps the operator's own word`);
      assert.notEqual(placed.label, symbol, symbol);
    }
  });

  test("a committed alias places the operator tile, whose sentence word is its own", () => {
    const { candidates, brain } = offeringAfterOperand(RuleSide.When, "literal", true);
    const labelOf = sentenceLabel(brain);

    const offering = resolveStripOffering(candidates, ">", labelOf);
    const placed = decideCandidateCommit(offering.visible, ">", "space");

    assert.ok(placed);
    assert.equal(placed.tileDef.tileId, greaterThanTileId);
    assert.equal(placed.origin.kind, "suggested");
    assert.equal(placed.label, tileSentenceWord(coreTile(greaterThanTileId), brain.servicesLocalizer()));
    assert.notEqual(placed.label, ">");
  });

  test("a symbol that opens a longer one surfaces both, the exact hit first", () => {
    const offering = resolveStripOffering(operatorOffering(">"), ">", stripLabel);

    assert.deepEqual(
      offering.visible.map((c) => c.tileDef.tileId),
      [greaterThanTileId, greaterOrEqualTileId]
    );
    assert.equal(decideCandidateCommit(offering.visible, ">", "space")?.tileDef.tileId, greaterThanTileId);
  });

  test("the next character narrows to the compound comparison", () => {
    const offering = resolveStripOffering(operatorOffering(">="), ">=", stripLabel);

    assert.deepEqual(
      offering.visible.map((c) => c.tileDef.tileId),
      [greaterOrEqualTileId]
    );
  });

  test("text no alias opens matches no operator", () => {
    const offering = resolveStripOffering(operatorOffering(">"), ">x", stripLabel);

    assert.deepEqual(offering.visible, []);
    assert.equal(offering.isUnknown, true);
  });

  test("a word alias climbs the same ladder a label does", () => {
    assert.equal(classifyTileMatch("a", "plus", ["add"]), "prefix");
    assert.equal(classifyTileMatch("ad", "plus", ["add"]), "prefix");
    assert.equal(classifyTileMatch("add", "plus", ["add"]), "exact");
    assert.equal(classifyTileMatch("adds", "plus", ["add"]), undefined);
    assert.equal(classifyTileMatch("plus", "plus", ["add"]), "exact");
    assert.equal(classifyTileMatch("zz", "plus", ["add"]), undefined);
  });

  test("digits after the symbol leave the alias behind", () => {
    const offering = resolveStripOffering(operatorOffering("-"), "-5", stripLabel);

    assert.deepEqual(offering.visible, [], "a longer filter opens no alias");
  });

  test("a typed negative number offers the literal and no operator", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();

    const offering = resolveStripOffering(candidates, "-5", sentenceLabel(brain));

    assert.equal(offering.visible[0]?.origin.kind, "minted-literal");
    assert.equal((offering.visible[0].tileDef as BrainTileLiteralDef).value, -5);
    assert.deepEqual(
      offering.visible.filter((c) => c.tileDef.kind === "operator"),
      []
    );
    assert.equal(decideCandidateCommit(offering.visible, "-5", "space")?.origin.kind, "minted-literal");
  });

  test("a lone minus where minus is not valid stays empty and silent", () => {
    const { candidates, brain } = offeringForEmptyWhenSide();

    const offering = resolveStripOffering(candidates, "-", sentenceLabel(brain));

    assert.deepEqual(offering.visible, []);
    assert.equal(offering.isUnknown, false);
    assert.deepEqual(mintedVariables(offering.offered), []);
    for (const key of ["enter", "tab", "space"] as const) {
      assert.equal(decideCandidateCommit(offering.visible, "-", key), undefined, key);
    }
  });

  test("a number in progress suppresses the mints and the amber, not ordinary matching", () => {
    const both = [
      candidate(subTileId, "minus"),
      candidate(numberLiteralFactoryId, "number"),
      candidate(numberVarFactoryId, "number variable"),
    ];

    const offering = resolveStripOffering(both, "-", stripLabel);

    assert.deepEqual(
      offering.visible.map((c) => c.tileDef.tileId),
      [subTileId],
      "the operator the symbol names is offered"
    );
    assert.equal(offering.isUnknown, false);
    assert.deepEqual(mintedVariables(offering.offered), [], "the number in progress mints no variable");
    assert.equal(
      decideCandidateCommit(offering.visible, "-", "space")?.tileDef.tileId,
      subTileId,
      "what is visible is what commits"
    );
  });

  test("a decimal point in progress still suppresses the mints and the amber", () => {
    const both = [
      candidate(subTileId, "minus"),
      candidate(numberLiteralFactoryId, "number"),
      candidate(numberVarFactoryId, "number variable"),
    ];

    const offering = resolveStripOffering(both, "1.", stripLabel);

    assert.deepEqual(offering.visible, []);
    assert.equal(offering.isUnknown, false);
    assert.deepEqual(mintedVariables(offering.offered), []);
  });
});
