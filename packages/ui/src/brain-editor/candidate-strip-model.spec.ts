/**
 * Pins the inline candidate strip's decision logic: what the oracle's
 * suggestions flatten into, how filter text ranks the offering, how the default
 * ranker orders the offering by category priority and then by provenance, which
 * candidate a commit key places, that unknown text can never commit, that typed
 * digits mint a literal candidate, and that the presentation seam is a
 * pass-through.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import {
  CoreControlFlowId,
  CoreLiteralFactoryId,
  CoreVariableFactoryId,
  mkControlFlowTileId,
  mkLiteralFactoryTileId,
  mkOperatorTileId,
  mkVariableFactoryTileId,
  RuleSide,
  TilePlacement,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import {
  suggestTiles,
  TileCompatibility,
  type TileSuggestion,
  type TileSuggestionResult,
} from "@mindcraft-lang/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileActuatorDef, type BrainTileLiteralDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import {
  bag,
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  mkActionDescriptor,
  mkActuatorTileId,
  mkCallDef,
  mkSensorTileId,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";
import type { ArmedTileTarget } from "./ArmedTargetContext";
import {
  arrangeCandidateSubcategories,
  buildStripCandidates,
  type CandidateProvenanceContext,
  candidateProvenanceBand,
  categoryPriorityCandidateRanker,
  decideCandidateCommit,
  filterStripCandidates,
  groupStripCandidates,
  identityCandidateRanker,
  isUnknownFilterText,
  mintNumberLiteralCandidate,
  type StripCandidate,
  tileCandidateGroup,
  toCandidateEntries,
} from "./candidate-strip-model";
import { kBestNextCandidateCount } from "./hooks/useCandidateStrip";
import { manufactureLiteralTile } from "./hooks/useTileSelection";
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

before(() => {
  services = __test__createBrainServices();
  seeTileIds = registerSeeCollisionSensors();
  rankingActuatorTileIds = registerRankingActuators();
  provenanceSensorTileIds = registerProvenanceSensors();
  platformInlineSensorTileId = registerPlatformInlineSensor();
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

/** The tile's authored display label, falling back to its id for tiles that carry no metadata label. */
function tileLabel(tileDef: IBrainTileDef): string {
  return tileDef.metadata?.label ?? tileDef.tileId;
}

/** The oracle's offering for an empty side of a fresh brain's first rule, with the target that arms that side. */
function offeringForEmptySide(side: RuleSide): {
  candidates: StripCandidate[];
  brain: BrainDef;
  target: ArmedTileTarget;
} {
  const brain = BrainDef.emptyBrainDef(services);
  const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
  const catalogs = List.from<ITileCatalog>([services.edit.tiles, brain.catalog()]).asReadonly();
  const tileSet = side === RuleSide.When ? rule.when() : rule.do();
  const context = buildInsertionContext({
    side,
    expr: tileSet.expr(),
    existingTiles: tileSet.tiles(),
    ruleDef: rule,
  });
  const suggested = suggestTiles(context, catalogs, services);
  return {
    candidates: buildStripCandidates(suggested, tileLabel),
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
    assert.equal(minted.origin.kind, "minted");
    if (minted.origin.kind === "minted") {
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
    assert.ok(minted && minted.origin.kind === "minted");

    const placed = manufactureLiteralTile(minted.origin.factoryTileDef, brain.catalog(), minted.origin.value);

    assert.ok(placed);
    assert.equal(placed.tileId, minted.tileDef.tileId);
    assert.equal(brain.catalog().get(placed.tileId), placed, "the placed literal is registered in the brain catalog");
    const again = manufactureLiteralTile(minted.origin.factoryTileDef, brain.catalog(), minted.origin.value);
    assert.equal(again, placed, "a second placement reuses the registered literal");
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
