/**
 * Suggestion-compiler consistency audit.
 *
 * A two-sided oracle over the tile picker: for an enumerated set of insertion
 * positions across a corpus of small real brains, and every tile in the
 * catalog, both directions are checked against the brain compiler:
 *
 * - Under-offer: a tile the compiler accepts at a position (clean compile, or
 *   a completable incomplete expression) must be offered by suggestTiles.
 * - Over-offer: every offered tile must, when actually inserted, be accepted
 *   by the compiler (or be a completable incomplete step), and must satisfy
 *   the picker's own gate contract (placement, capabilities, output identity,
 *   WHEN result).
 *
 * Expectations are derived by performing the insertion and running the real
 * pipeline (parseRule for parse + type diagnostics, runBrainLinkPipeline for
 * codegen and link diagnostics); nothing is hand-authored per position.
 *
 * Legitimate asymmetries between the two sides are encoded as the named
 * normalization rules below, each with a one-line justification. Anything not
 * covered by a rule is a discrepancy: it must appear in the shrink-only
 * KNOWN_DISCREPANCIES allowlist or the audit fails. An allowlisted entry that
 * stops reproducing also fails, so a fix must remove its entry.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List, type ReadonlyList, UniqueSet } from "@mindcraft-lang/core";
import {
  type BrainServices,
  CoreControlFlowId,
  type IBrainRuleDef,
  type IBrainTileDef,
  type ITileCatalog,
  mkControlFlowTileId,
  mkOperatorTileId,
  RuleSide,
  TilePlacement,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import type { Expr } from "@mindcraft-lang/core/brain/compiler";
import {
  type BrainBuildDiagnostic,
  ParseDiagCode,
  parseRule,
  runBrainLinkPipeline,
  TypeDiagCode,
} from "@mindcraft-lang/core/brain/compiler";
import {
  countUnclosedParens,
  getRuleWhenResultType,
  getTileOutputType,
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@mindcraft-lang/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainTileAccessorDef,
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileMissingDef,
  BrainTileModifierDef,
  BrainTileOutputDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import {
  bag,
  CoreOpId,
  CoreTypeIds,
  type IConversionRegistry,
  mkActionDescriptor,
  mkCallDef,
  mod,
  NIL_VALUE,
  optional,
  param,
  seq,
  TARGET_ACTION_ID_BASE,
  type TypeId,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";
import { BitSet } from "@mindcraft-lang/core/util";

// ---- Services and probe tiles ----

let services: BrainServices;

/** Struct type with Number and String fields, with accessors. */
let vecTypeId: TypeId;
/** Struct type with a single Number field. */
let rawTypeId: TypeId;

const probeTiles = {} as {
  numVar: BrainTileVariableDef;
  strVar: BrainTileVariableDef;
  vecVar: BrainTileVariableDef;
  rawVar: BrainTileVariableDef;
  accX: BrainTileAccessorDef;
  accLabel: BrainTileAccessorDef;
  accRawX: BrainTileAccessorDef;
  numLit: BrainTileLiteralDef;
  strLit: BrainTileLiteralDef;
  boolLit: BrainTileLiteralDef;
  /** Inline no-arg value sensor returning the struct type. */
  vecSensor: BrainTileSensorDef;
  /** Inline no-arg value sensor returning Number. */
  numSensor: BrainTileSensorDef;
  /** Non-inline WHEN-side Boolean sensor with an optional modifier. */
  seesSensor: BrainTileSensorDef;
  seesMod: BrainTileModifierDef;
  /** WHEN-side Number event sensor providing a named output and a capability. */
  beaconSensor: BrainTileSensorDef;
  beaconOutput: BrainTileOutputDef;
  /** Literal gated on the capability the beacon sensor provides. */
  gatedLit: BrainTileLiteralDef;
  /** DO-side actuator consuming a Number WHEN result. */
  replyActuator: BrainTileActuatorDef;
  /** DO-side actuator consuming a struct WHEN result (never satisfiable in corpus). */
  vecReplyActuator: BrainTileActuatorDef;
  /** DO-side actuator: anonymous Number slot, optional named param, optional modifier. */
  driveActuator: BrainTileActuatorDef;
  drivePower: BrainTileParameterDef;
  driveMod: BrainTileModifierDef;
  /** DO-side actuator with no arguments. */
  beepActuator: BrainTileActuatorDef;
};

const PROBE_CAPABILITY_BIT = 8;

function registerProbeTiles(): void {
  const tiles = services.edit.tiles;
  const types = services.runtime.types;
  const fns = services.runtime.functions;

  vecTypeId = types.addStructType("ProbeVec", {
    atomId: 20001,
    fields: List.from([
      { name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 },
      { name: "label", typeId: CoreTypeIds.String, fieldIndex: 1 },
    ]),
  });
  rawTypeId = types.addStructType("ProbeRaw", {
    atomId: 20002,
    fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
  });
  probeTiles.accX = new BrainTileAccessorDef(vecTypeId, "x", CoreTypeIds.Number, { metadata: { label: "x" } });
  probeTiles.accLabel = new BrainTileAccessorDef(vecTypeId, "label", CoreTypeIds.String, {
    metadata: { label: "label" },
  });
  probeTiles.accRawX = new BrainTileAccessorDef(rawTypeId, "x", CoreTypeIds.Number, { metadata: { label: "raw x" } });

  probeTiles.numVar = new BrainTileVariableDef("probe.numVar", "score", CoreTypeIds.Number, "probe-var-num");
  probeTiles.strVar = new BrainTileVariableDef("probe.strVar", "name", CoreTypeIds.String, "probe-var-str");
  probeTiles.vecVar = new BrainTileVariableDef("probe.vecVar", "vec", vecTypeId, "probe-var-vec");
  probeTiles.rawVar = new BrainTileVariableDef("probe.rawVar", "raw", rawTypeId, "probe-var-raw");

  probeTiles.numLit = new BrainTileLiteralDef(CoreTypeIds.Number, 7, {}, services);
  probeTiles.strLit = new BrainTileLiteralDef(CoreTypeIds.String, "probe", {}, services);
  probeTiles.boolLit = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, services);

  const vecSensorFn = fns.register(4101, "probe-vec-read", false, { exec: () => NIL_VALUE }, mkCallDef(bag()));
  probeTiles.vecSensor = new BrainTileSensorDef(
    "probe-vec-read",
    mkActionDescriptor("sensor", vecSensorFn, vecTypeId),
    {
      placement: TilePlacement.EitherSide | TilePlacement.Inline,
      metadata: { label: "vec reading" },
    }
  );

  const numSensorFn = fns.register(4102, "probe-num-read", false, { exec: () => NIL_VALUE }, mkCallDef(bag()));
  probeTiles.numSensor = new BrainTileSensorDef(
    "probe-num-read",
    mkActionDescriptor("sensor", numSensorFn, CoreTypeIds.Number),
    {
      placement: TilePlacement.EitherSide | TilePlacement.Inline,
      metadata: { label: "num reading" },
    }
  );

  probeTiles.seesMod = new BrainTileModifierDef("probe.seesNear", { metadata: { label: "near" } });
  const seesFn = fns.register(
    4103,
    "probe-sees",
    false,
    { exec: () => VOID_VALUE },
    mkCallDef(optional(mod("probe.seesNear")))
  );
  probeTiles.seesSensor = new BrainTileSensorDef(
    "probe-sees",
    mkActionDescriptor("sensor", seesFn, CoreTypeIds.Boolean),
    {
      metadata: { label: "sees" },
    }
  );

  probeTiles.beaconOutput = new BrainTileOutputDef(CoreTypeIds.Number, "signal", { metadata: { label: "signal" } });
  const beaconFn = fns.register(4104, "probe-beacon", false, { exec: () => NIL_VALUE }, mkCallDef(bag()));
  probeTiles.beaconSensor = new BrainTileSensorDef(
    "probe-beacon",
    mkActionDescriptor("sensor", beaconFn, CoreTypeIds.Number),
    {
      metadata: { label: "beacon" },
      capabilities: new BitSet().set(PROBE_CAPABILITY_BIT),
      providedOutputs: List.from([probeTiles.beaconOutput.outputKey]),
    }
  );

  probeTiles.gatedLit = new BrainTileLiteralDef(
    CoreTypeIds.Number,
    42,
    {
      requirements: new BitSet().set(PROBE_CAPABILITY_BIT),
    },
    services
  );

  const replyFn = fns.register(4105, "probe-reply", false, { exec: () => VOID_VALUE }, mkCallDef(bag()));
  probeTiles.replyActuator = new BrainTileActuatorDef("probe-reply", mkActionDescriptor("actuator", replyFn), {
    metadata: { label: "reply" },
    consumesWhenResult: CoreTypeIds.Number,
  });

  const vecReplyFn = fns.register(4106, "probe-vec-reply", false, { exec: () => VOID_VALUE }, mkCallDef(bag()));
  probeTiles.vecReplyActuator = new BrainTileActuatorDef(
    "probe-vec-reply",
    mkActionDescriptor("actuator", vecReplyFn),
    {
      metadata: { label: "vec reply" },
      consumesWhenResult: vecTypeId,
    }
  );

  probeTiles.drivePower = new BrainTileParameterDef("probe.power", CoreTypeIds.Number, {
    metadata: { label: "power" },
  });
  probeTiles.driveMod = new BrainTileModifierDef("probe.driveFast", { metadata: { label: "fast" } });
  const speedParam = new BrainTileParameterDef("probe.speed", CoreTypeIds.Number, { metadata: { label: "speed" } });
  const driveFn = fns.register(
    4107,
    "probe-drive",
    false,
    { exec: () => VOID_VALUE },
    mkCallDef(
      seq(
        param("probe.speed", { name: "speed", required: true, anonymous: true }),
        bag(optional(param("probe.power")), optional(mod("probe.driveFast")))
      )
    )
  );
  probeTiles.driveActuator = new BrainTileActuatorDef("probe-drive", mkActionDescriptor("actuator", driveFn), {
    metadata: { label: "drive" },
  });

  const beepFn = fns.register(4108, "probe-beep", false, { exec: () => VOID_VALUE }, mkCallDef(bag()));
  probeTiles.beepActuator = new BrainTileActuatorDef("probe-beep", mkActionDescriptor("actuator", beepFn), {
    metadata: { label: "beep" },
  });

  tiles.registerTileDef(speedParam);
  for (const def of Object.values(probeTiles)) {
    tiles.registerTileDef(def);
  }

  // Host bindings so probe actions resolve and link through the real pipeline.
  const actionTiles = [
    probeTiles.vecSensor,
    probeTiles.numSensor,
    probeTiles.seesSensor,
    probeTiles.beaconSensor,
    probeTiles.replyActuator,
    probeTiles.vecReplyActuator,
    probeTiles.driveActuator,
    probeTiles.beepActuator,
  ];
  let nextActionId = TARGET_ACTION_ID_BASE + 900;
  for (const tile of actionTiles) {
    services.runtime.actions.register({
      binding: "host",
      id: nextActionId++,
      descriptor: tile.action,
      execSync: () => NIL_VALUE,
    });
  }
}

// ---- Corpus ----

/**
 * One corpus brain: a named builder producing a BrainDef whose rules supply
 * the audited insertion positions. Builders use only probe and core tiles.
 */
interface CorpusEntry {
  name: string;
  build(): BrainDef;
}

function newBrain(name: string): { brain: BrainDef; rule: BrainRuleDef } {
  const brain = BrainDef.emptyBrainDef(services, name);
  const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
  return { brain, rule };
}

function fill(rule: IBrainRuleDef, when: IBrainTileDef[], doTiles: IBrainTileDef[]): void {
  for (const t of when) rule.when().appendTile(t);
  for (const t of doTiles) rule.do().appendTile(t);
}

function corpus(): CorpusEntry[] {
  const t = probeTiles;
  const entries: CorpusEntry[] = [
    {
      name: "empty-rule",
      build: () => newBrain("empty-rule").brain,
    },
    {
      name: "bare-do-literal",
      build: () => {
        const { brain, rule } = newBrain("bare-do-literal");
        fill(rule, [], [t.numLit]);
        return brain;
      },
    },
    {
      name: "when-bool-sensor",
      build: () => {
        const { brain, rule } = newBrain("when-bool-sensor");
        fill(rule, [t.seesSensor], [t.beepActuator]);
        return brain;
      },
    },
    {
      name: "assignment-num",
      build: () => {
        const { brain, rule } = newBrain("assignment-num");
        const assign = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Assign))!;
        fill(rule, [], [t.numVar, assign, t.numLit]);
        return brain;
      },
    },
    {
      name: "assignment-struct-field",
      build: () => {
        const { brain, rule } = newBrain("assignment-struct-field");
        const assign = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Assign))!;
        fill(rule, [], [t.vecVar, t.accX, assign, t.numSensor]);
        return brain;
      },
    },
    {
      name: "binary-op-operands",
      build: () => {
        const { brain, rule } = newBrain("binary-op-operands");
        const add = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Add))!;
        fill(rule, [t.numSensor, add, t.numLit], [t.beepActuator]);
        return brain;
      },
    },
    {
      name: "unary-not",
      build: () => {
        const { brain, rule } = newBrain("unary-not");
        const not = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Not))!;
        fill(rule, [not, t.seesSensor], [t.beepActuator]);
        return brain;
      },
    },
    {
      name: "action-anon-slot",
      build: () => {
        const { brain, rule } = newBrain("action-anon-slot");
        fill(rule, [], [t.driveActuator, t.numLit]);
        return brain;
      },
    },
    {
      name: "action-named-param",
      build: () => {
        const { brain, rule } = newBrain("action-named-param");
        fill(rule, [], [t.driveActuator, t.numLit, t.drivePower, t.numLit]);
        return brain;
      },
    },
    {
      name: "action-slot-open",
      build: () => {
        const { brain, rule } = newBrain("action-slot-open");
        fill(rule, [], [t.driveActuator]);
        return brain;
      },
    },
    {
      name: "field-access-chain",
      build: () => {
        const { brain, rule } = newBrain("field-access-chain");
        fill(rule, [], [t.driveActuator, t.vecVar, t.accX]);
        return brain;
      },
    },
    {
      name: "inline-struct-sensor",
      build: () => {
        const { brain, rule } = newBrain("inline-struct-sensor");
        fill(rule, [t.vecSensor], [t.beepActuator]);
        return brain;
      },
    },
    {
      name: "unclosed-paren",
      build: () => {
        const { brain, rule } = newBrain("unclosed-paren");
        const open = services.edit.tiles.get(mkControlFlowTileId(CoreControlFlowId.OpenParen))!;
        const add = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Add))!;
        fill(rule, [], [t.driveActuator, open, t.numLit, add, t.numLit]);
        return brain;
      },
    },
    {
      name: "output-provider-child",
      build: () => {
        const { brain, rule } = newBrain("output-provider-child");
        fill(rule, [t.beaconSensor], []);
        const child = rule.appendNewRule();
        fill(child, [], [t.driveActuator, t.beaconOutput]);
        return brain;
      },
    },
    {
      name: "no-output-provider",
      build: () => {
        const { brain, rule } = newBrain("no-output-provider");
        fill(rule, [t.seesSensor], [t.beepActuator]);
        return brain;
      },
    },
    {
      name: "when-result-number",
      build: () => {
        const { brain, rule } = newBrain("when-result-number");
        fill(rule, [t.numSensor], [t.replyActuator]);
        return brain;
      },
    },
    {
      name: "when-result-child",
      build: () => {
        const { brain, rule } = newBrain("when-result-child");
        fill(rule, [t.numSensor], []);
        const child = rule.appendNewRule();
        fill(child, [t.seesSensor], [t.beepActuator]);
        return brain;
      },
    },
    {
      name: "struct-var-do",
      build: () => {
        const { brain, rule } = newBrain("struct-var-do");
        const assign = services.edit.tiles.get(mkOperatorTileId(CoreOpId.Assign))!;
        fill(rule, [], [t.vecVar, assign, t.vecSensor]);
        return brain;
      },
    },
    {
      name: "raw-struct-var-do",
      build: () => {
        const { brain, rule } = newBrain("raw-struct-var-do");
        fill(rule, [], [t.rawVar]);
        return brain;
      },
    },
  ];
  return entries;
}

// ---- Positions ----

interface Position {
  key: string;
  /** Stable identity of the enclosing (brain, rule) pair, for memoization. */
  ruleKey: string;
  brain: BrainDef;
  rule: IBrainRuleDef;
  side: RuleSide;
  /** Tile index being replaced, or undefined for append-at-tail. */
  replaceIndex?: number;
}

function sideName(side: RuleSide): string {
  return side === RuleSide.When ? "when" : "do";
}

function enumeratePositions(entry: CorpusEntry): Position[] {
  const brain = entry.build();
  const positions: Position[] = [];
  const walkRule = (rule: IBrainRuleDef, path: string) => {
    const ruleKey = `${entry.name}/${path}`;
    for (const side of [RuleSide.When, RuleSide.Do]) {
      const tiles = rule.side(side).tiles();
      positions.push({ key: `${ruleKey}/${sideName(side)}/append`, ruleKey, brain, rule, side });
      for (let i = 0; i < tiles.size(); i++) {
        positions.push({
          key: `${ruleKey}/${sideName(side)}/replace@${i}`,
          ruleKey,
          brain,
          rule,
          side,
          replaceIndex: i,
        });
      }
    }
    const children = rule.children();
    for (let i = 0; i < children.size(); i++) {
      walkRule(children.get(i), `${path}/${i}`);
    }
  };
  const pages = brain.pages();
  for (let p = 0; p < pages.size(); p++) {
    const rules = pages.get(p).children();
    for (let r = 0; r < rules.size(); r++) {
      walkRule(rules.get(r), `${p}-${r}`);
    }
  }
  return positions;
}

// ---- InsertionContext derivation ----

/**
 * Capabilities and output identities available at a position: the OR of
 * `capabilities()` and union of `providedOutputs()` over every tile in the
 * enclosing rule hierarchy that precedes the insertion point (ancestor rules'
 * WHEN and DO sides, the current rule's WHEN side when inserting on DO, and
 * the tiles before the insertion index on the edited side).
 */
function deriveGates(pos: Position): { caps: BitSet; outputKeys: UniqueSet<string> } {
  const caps = new BitSet();
  const outputKeys = new UniqueSet<string>();
  const absorb = (tiles: ReadonlyList<IBrainTileDef>, limit?: number) => {
    const n = limit === undefined ? tiles.size() : limit;
    for (let i = 0; i < n; i++) {
      const tile = tiles.get(i);
      const tileCaps = tile.capabilities();
      if (!tileCaps.isEmpty()) {
        const msb = tileCaps.msb();
        for (let b = 0; b <= msb; b++) {
          if (tileCaps.get(b) === 1) caps.set(b);
        }
      }
      const provided = tile.providedOutputs();
      for (let k = 0; k < provided.size(); k++) {
        outputKeys.add(provided.get(k));
      }
    }
  };
  let ancestor = pos.rule.ancestor();
  while (ancestor) {
    absorb(ancestor.when().tiles());
    absorb(ancestor.do().tiles());
    ancestor = ancestor.ancestor();
  }
  if (pos.side === RuleSide.Do) {
    absorb(pos.rule.when().tiles());
  }
  const ownTiles = pos.rule.side(pos.side).tiles();
  absorb(ownTiles, pos.replaceIndex ?? ownTiles.size());
  return { caps, outputKeys };
}

function deriveContext(pos: Position): InsertionContext {
  const tiles = pos.rule.side(pos.side).tiles();
  const { caps, outputKeys } = deriveGates(pos);
  return {
    ruleSide: pos.side,
    ruleDef: pos.rule,
    expr: parseTilesForSuggestions(tiles),
    replaceTileIndex: pos.replaceIndex,
    availableCapabilities: caps,
    availableOutputKeys: outputKeys,
    unclosedParenDepth: countUnclosedParens(tiles, pos.replaceIndex),
  };
}

// ---- Compiler oracle ----

type Verdict = "complete" | "incomplete" | "invalid";

/** Parse diagnostics that mean "the expression is unfinished", not "wrong". */
const INCOMPLETENESS_CODES = new Set<number>([
  ParseDiagCode.ExpectedExpressionFoundEOF,
  ParseDiagCode.ExpectedExpressionInSubExpr,
  ParseDiagCode.ActionCallParseFailure,
  ParseDiagCode.ExpectedClosingParen,
]);

function catalogList(): List<ITileCatalog> {
  return List.from([services.edit.tiles]);
}

interface SideVerdict {
  verdict: Verdict;
  /** True when the parse carried no conversion diagnostics. */
  conversionFree: boolean;
}

const verdictMemo = new Map<string, SideVerdict>();

function tileListKey(tiles: ReadonlyList<IBrainTileDef>): string {
  let key = "";
  for (let i = 0; i < tiles.size(); i++) {
    key += `${tiles.get(i).tileId};`;
  }
  return key;
}

/**
 * Parse + type-check verdict for one side's tile list, judged in isolation
 * (the other side does not constrain what the inserted tile may be).
 * "complete" means no diagnostics beyond informational conversions;
 * "incomplete" means only unfinished-expression diagnostics were produced
 * (type diagnostics are ignored: the unfinished tail cannot type-check, so
 * acceptance is decided by the completion search instead);
 * "invalid" means a structural or type error was reported.
 */
function sideVerdict(tiles: ReadonlyList<IBrainTileDef>, side: RuleSide): SideVerdict {
  const key = `${side}|${tileListKey(tiles)}`;
  const memoized = verdictMemo.get(key);
  if (memoized !== undefined) return memoized;

  const empty = List.empty<IBrainTileDef>();
  const result =
    side === RuleSide.When
      ? parseRule(tiles, empty, catalogList(), services.shared.conversions, services.runtime.types)
      : parseRule(empty, tiles, catalogList(), services.shared.conversions, services.runtime.types);
  let verdict: Verdict = "complete";
  for (let i = 0; i < result.parseResult.diags.size(); i++) {
    const code = result.parseResult.diags.get(i).code as number;
    if (INCOMPLETENESS_CODES.has(code)) {
      if (verdict === "complete") verdict = "incomplete";
    } else {
      verdict = "invalid";
      break;
    }
  }
  let conversionFree = true;
  if (verdict === "complete") {
    for (let i = 0; i < result.typeInfo.diags.size(); i++) {
      const code = result.typeInfo.diags.get(i).code as number;
      if (code === TypeDiagCode.DataTypeConverted) {
        conversionFree = false;
      } else {
        verdict = "invalid";
        break;
      }
    }
  }
  const sv: SideVerdict = { verdict, conversionFree: verdict === "complete" && conversionFree };
  verdictMemo.set(key, sv);
  return sv;
}

/**
 * Terminal tiles used to extend an unfinished insertion: one value of each
 * primitive type, both struct variables, the probe accessors (a struct value
 * may await its accessor), and the close paren. An accessor is only tried
 * directly after a tile producing its struct type.
 */
function completionKit(): IBrainTileDef[] {
  const closeParen = services.edit.tiles.get(mkControlFlowTileId(CoreControlFlowId.CloseParen))!;
  return [
    probeTiles.numLit,
    probeTiles.strLit,
    probeTiles.boolLit,
    probeTiles.vecVar,
    probeTiles.rawVar,
    probeTiles.accX,
    probeTiles.accLabel,
    probeTiles.accRawX,
    closeParen,
  ];
}

/** Whether `next` may follow `prev` in a completion: accessors only attach to their own struct type. */
function completionStepAllowed(prev: IBrainTileDef | undefined, next: IBrainTileDef): boolean {
  if (next.kind !== "accessor") return true;
  if (prev === undefined) return false;
  return getTileOutputType(prev) === (next as BrainTileAccessorDef).structTypeId;
}

const pipelineMemo = new Map<string, boolean>();

/**
 * Full compile + link + treeshake acceptance for the position's brain with
 * the mutated side applied, catching codegen- and link-level rejections. The
 * same rule's other side is temporarily cleared when it does not parse clean
 * on its own (a corpus rule captured mid-edit must not veto probes on its
 * sibling side).
 */
function pipelineAccepts(pos: Position, mutated: ReadonlyList<IBrainTileDef>): boolean {
  const key = `${pos.ruleKey}|${sideName(pos.side)}|${tileListKey(mutated)}`;
  const memoized = pipelineMemo.get(key);
  if (memoized !== undefined) return memoized;

  const tileSet = pos.rule.side(pos.side);
  const otherSide = pos.side === RuleSide.When ? RuleSide.Do : RuleSide.When;
  const otherSet = pos.rule.side(otherSide);
  const clearOther = sideVerdict(otherSet.tiles(), otherSide).verdict !== "complete";

  const original = copyTiles(tileSet.tiles());
  const otherOriginal = copyTiles(otherSet.tiles());
  setSideTiles(tileSet, mutated);
  if (clearOther) setSideTiles(otherSet, List.empty<IBrainTileDef>());

  const result = runBrainLinkPipeline(
    pos.brain,
    {
      catalogs: catalogList(),
      actionResolver: services.runtime.actions,
      typeRegistry: services.runtime.types,
    },
    services.shared.conversions
  );
  let accepted = result.program !== undefined;
  if (accepted) {
    for (let i = 0; i < result.diagnostics.size(); i++) {
      const diag: BrainBuildDiagnostic = result.diagnostics.get(i);
      if (diag.severity === "error") {
        accepted = false;
        break;
      }
    }
  }

  setSideTiles(tileSet, original);
  if (clearOther) setSideTiles(otherSet, otherOriginal);

  pipelineMemo.set(key, accepted);
  return accepted;
}

function setSideTiles(
  tileSet: {
    tiles(): ReadonlyList<IBrainTileDef>;
    appendTile(t: IBrainTileDef): void;
    removeTileAtIndex(i: number): void;
  },
  tiles: ReadonlyList<IBrainTileDef>
): void {
  while (tileSet.tiles().size() > 0) tileSet.removeTileAtIndex(0);
  for (let i = 0; i < tiles.size(); i++) tileSet.appendTile(tiles.get(i));
}

function copyTiles(tiles: ReadonlyList<IBrainTileDef>): List<IBrainTileDef> {
  const copy = List.empty<IBrainTileDef>();
  for (let i = 0; i < tiles.size(); i++) copy.push(tiles.get(i));
  return copy;
}

/** Builds the mutated tile list for inserting `tile` at the position. */
function mutatedSide(pos: Position, tile: IBrainTileDef): List<IBrainTileDef> {
  const tiles = pos.rule.side(pos.side).tiles();
  const mutated = List.empty<IBrainTileDef>();
  for (let i = 0; i < tiles.size(); i++) {
    mutated.push(pos.replaceIndex === i ? tile : tiles.get(i));
  }
  if (pos.replaceIndex === undefined) mutated.push(tile);
  return mutated;
}

interface Acceptance {
  status: "complete" | "incomplete" | "rejected";
  /** True when some accepted parse of the insertion carries no conversion diagnostic. */
  conversionFree: boolean;
}

/**
 * Whether the side tile list, possibly after draining any unclosed parens
 * with close-paren tiles, parses complete; the pipeline then confirms it.
 */
function listAccepted(pos: Position, list: List<IBrainTileDef>): { ok: boolean; conversionFree: boolean } {
  let v = sideVerdict(list, pos.side);
  if (v.verdict === "incomplete") {
    const depth = countUnclosedParens(list);
    if (depth > 0) {
      const closeParen = services.edit.tiles.get(mkControlFlowTileId(CoreControlFlowId.CloseParen))!;
      const drained = copyTiles(list);
      for (let i = 0; i < depth; i++) drained.push(closeParen);
      v = sideVerdict(drained, pos.side);
      if (v.verdict === "complete" && pipelineAccepts(pos, drained)) {
        return { ok: true, conversionFree: v.conversionFree };
      }
      return { ok: false, conversionFree: false };
    }
  }
  if (v.verdict === "complete" && pipelineAccepts(pos, list)) {
    return { ok: true, conversionFree: v.conversionFree };
  }
  return { ok: false, conversionFree: false };
}

/**
 * Compiler-side acceptance of the mutated side list, with completion tiles
 * tried at the given insertion points (depth up to 2 per point):
 * - "complete": the list is accepted as-is;
 * - "incomplete": the insertion is a step -- some completion is accepted;
 * - "rejected": no parse of the insertion is accepted.
 */
function listAcceptance(pos: Position, mutated: List<IBrainTileDef>, insertPoints: number[]): Acceptance {
  const direct = sideVerdict(mutated, pos.side);
  if (direct.verdict === "complete") {
    return pipelineAccepts(pos, mutated)
      ? { status: "complete", conversionFree: direct.conversionFree }
      : { status: "rejected", conversionFree: false };
  }
  const directDrained = listAccepted(pos, mutated);
  let accepted = directDrained.ok;
  let conversionFree = directDrained.conversionFree;

  const kit = completionKit();
  for (const insertAt of insertPoints) {
    if (accepted && conversionFree) break;
    const precedingTile = insertAt > 0 ? mutated.get(insertAt - 1) : undefined;
    for (const first of kit) {
      if (!completionStepAllowed(precedingTile, first)) continue;
      mutated.insert(insertAt, first);
      const r1 = listAccepted(pos, mutated);
      if (r1.ok) {
        accepted = true;
        conversionFree = conversionFree || r1.conversionFree;
      } else if (sideVerdict(mutated, pos.side).verdict === "incomplete") {
        for (const second of kit) {
          if (!completionStepAllowed(first, second)) continue;
          mutated.insert(insertAt + 1, second);
          const r2 = listAccepted(pos, mutated);
          if (r2.ok) {
            accepted = true;
            conversionFree = conversionFree || r2.conversionFree;
          }
          mutated.remove(insertAt + 1);
          if (accepted && conversionFree) break;
        }
      }
      mutated.remove(insertAt);
      if (accepted && conversionFree) break;
    }
  }
  return accepted ? { status: "incomplete", conversionFree } : { status: "rejected", conversionFree: false };
}

/**
 * Compiler-side acceptance of inserting `tile` at the position. Completions
 * are tried both directly after the inserted tile (a prefix operator or a
 * struct value needs its continuation there) and at the end of the side (an
 * open group or trailing operator is finished there).
 */
function insertionAcceptance(pos: Position, tile: IBrainTileDef): Acceptance {
  const mutated = mutatedSide(pos, tile);
  const afterTile = (pos.replaceIndex ?? mutated.size() - 1) + 1;
  const points = afterTile === mutated.size() ? [afterTile] : [afterTile, mutated.size()];
  return listAcceptance(pos, mutated, points);
}

// ---- Normalization rules ----
//
// Each rule names a legitimate asymmetry between the picker's offer set and
// raw compiler acceptance, with a one-line justification tied to the picker's
// documented model. A rule returning true means "this non-offer / offer needs
// no finding". Anything not covered by a rule is a discrepancy.

/** Hidden and deprecated tiles are excluded from every offer set by contract. */
function hiddenFiltered(tile: IBrainTileDef): boolean {
  return tile.hidden === true || tile.deprecated === true;
}

/** Capability requirements gate offers only; the compiler does not model capabilities (hole pinned below). */
function capabilityGateFiltered(tile: IBrainTileDef, ctx: InsertionContext): boolean {
  const requirements = tile.requirements();
  if (requirements.isEmpty() || ctx.availableCapabilities === undefined) return false;
  const msb = requirements.msb();
  for (let b = 0; b <= msb; b++) {
    if (requirements.get(b) === 1 && ctx.availableCapabilities.get(b) === 0) return true;
  }
  return false;
}

/** Output tiles are offered only under a providing sensor; the compiler reads the backing variable unchecked (hole pinned below). */
function outputGateFiltered(tile: IBrainTileDef, ctx: InsertionContext): boolean {
  if (tile.kind !== "output" || ctx.availableOutputKeys === undefined) return false;
  return !ctx.availableOutputKeys.has((tile as BrainTileOutputDef).outputKey);
}

/** WHEN-result consumers are offered only where a compatible WHEN result exists; the compiler compiles the read unchecked (hole pinned below). */
function whenResultGateFiltered(tile: IBrainTileDef, ctx: InsertionContext, conversions: IConversionRegistry): boolean {
  const required = tile.consumesWhenResult();
  if (required === undefined) return false;
  const available = availableWhenResultTypeOf(ctx);
  if (available === undefined) return true;
  if (available === required) return false;
  const path = conversions.findBestPath(available, required);
  return path === undefined || path.size() === 0;
}

/** Factory tiles never land in a tile list: picking one instantiates a concrete variable/literal tile in the editor. */
function factoryInstantiatesOnInsert(tile: IBrainTileDef): boolean {
  return tile.kind === "factory";
}

/** The nil literal is never offered at typed positions: nil is not a tile-selectable type (the picker's expected-type inference skips Nil), though the compiler accepts nil values. */
function nilLiteralNeverOffered(tile: IBrainTileDef): boolean {
  return tile.kind === "literal" && (tile as BrainTileLiteralDef).valueType === CoreTypeIds.Nil;
}

/** The parsed root expression of the position's unmutated side. */
function sideRootExpr(pos: Position): Expr | undefined {
  const tiles = pos.rule.side(pos.side).tiles();
  if (tiles.size() === 0) return undefined;
  const empty = List.empty<IBrainTileDef>();
  const result =
    pos.side === RuleSide.When
      ? parseRule(tiles, empty, catalogList(), services.shared.conversions, services.runtime.types)
      : parseRule(empty, tiles, catalogList(), services.shared.conversions, services.runtime.types);
  const exprs = pos.side === RuleSide.When ? result.whenParseResult.exprs : result.doParseResult.exprs;
  return exprs.size() > 0 ? exprs.get(0) : undefined;
}

/** Replacing a root action tile treats the position as an expression start by design; the stale call args left behind re-parse as recovery for the user to fix. */
function isRootActionHeadReplacement(pos: Position): boolean {
  if (pos.replaceIndex === undefined) return false;
  const root = sideRootExpr(pos);
  if (root === undefined || (root.kind !== "actuator" && root.kind !== "sensor")) return false;
  return pos.replaceIndex === root.span.from;
}

/** Replacing a paren rewrites expression structure; the suffix re-parses as recovery by design (the picker's transparent-token fallthrough). */
function isParenReplacement(pos: Position): boolean {
  if (pos.replaceIndex === undefined) return false;
  const tile = pos.rule.side(pos.side).tiles().get(pos.replaceIndex);
  return tile.kind === "controlFlow";
}

/** Replacing the base of a field access is an expression start by design: the picker offers value tiles unrestricted there, and the stale accessor suffix re-parses as recovery for the user to fix. */
function isAccessorBaseReplacement(pos: Position): boolean {
  if (pos.replaceIndex === undefined) return false;
  const tiles = pos.rule.side(pos.side).tiles();
  return pos.replaceIndex + 1 < tiles.size() && tiles.get(pos.replaceIndex + 1).kind === "accessor";
}

/** True for tile kinds the picker offers as expression starts (value tiles). */
function isValueStartKind(tile: IBrainTileDef): boolean {
  return tile.kind === "literal" || tile.kind === "variable" || tile.kind === "output" || tile.kind === "sensor";
}

/** Acceptance of the insertion judged on the prefix through the inserted tile only, for replacement shapes whose suffix legitimately breaks. */
function prefixAcceptance(pos: Position, tile: IBrainTileDef): Acceptance {
  const tiles = pos.rule.side(pos.side).tiles();
  const truncated = List.empty<IBrainTileDef>();
  const end = pos.replaceIndex ?? tiles.size();
  for (let i = 0; i < end; i++) truncated.push(tiles.get(i));
  truncated.push(tile);
  return listAcceptance(pos, truncated, [truncated.size()]);
}

/** Actuators are excluded from value positions by design (they return Void); an actuator replacement accepted only by re-parsing the suffix into its call args is not an under-offer. */
function actuatorRescuedByReparse(tile: IBrainTileDef, pos: Position, acceptance: Acceptance): boolean {
  return tile.kind === "actuator" && pos.replaceIndex !== undefined && acceptance.status === "incomplete";
}

/** Named call-spec arg tiles are all offered regardless of seq order (documented picker leniency); the parser enforces sequence order. */
function namedArgOfEnclosingCall(tile: IBrainTileDef, pos: Position): boolean {
  if (tile.kind !== "modifier" && tile.kind !== "parameter") return false;
  const root = sideRootExpr(pos);
  if (root === undefined || (root.kind !== "actuator" && root.kind !== "sensor")) return false;
  const argSlots = root.tileDef.action.callDef.argSlots;
  for (let i = 0; i < argSlots.size(); i++) {
    const argTileId = argSlots.get(i).argSpec.tileId;
    if (tile.tileId.endsWith(argTileId) || argTileId === tile.tileId) return true;
  }
  return false;
}

/** Operators are offered only with a direct (conversion-free) operand overload by design; the compiler converts operands. */
function operatorNeedsConversion(tile: IBrainTileDef, acceptance: Acceptance): boolean {
  return tile.kind === "operator" && !acceptance.conversionFree;
}

/**
 * Compiler acceptance of an accessor insertion: the compiler validates the
 * accessor/base pairing, so acceptance is the gate in both directions. An
 * accessor at a replacement position binds tighter than what it replaces and
 * legitimately re-parses the suffix, so prefix acceptance also counts there.
 */
function accessorInsertionAccepted(tile: IBrainTileDef, pos: Position): boolean {
  return (
    insertionAcceptance(pos, tile).status !== "rejected" ||
    (pos.replaceIndex !== undefined && prefixAcceptance(pos, tile).status !== "rejected")
  );
}

/** The picker's WHEN-result availability, recomputed from the rule the same way suggestTiles derives it. */
function availableWhenResultTypeOf(ctx: InsertionContext): TypeId | undefined {
  if (ctx.ruleDef === undefined) return undefined;
  if (ctx.ruleSide === RuleSide.When) {
    const ancestor = ctx.ruleDef.ancestor();
    return ancestor ? getRuleWhenResultType(ancestor, services) : undefined;
  }
  return getRuleWhenResultType(ctx.ruleDef, services);
}

// ---- Discrepancy collection ----

interface Discrepancy {
  position: string;
  tileId: string;
  direction: "under-offer" | "over-offer";
  detail: string;
}

function offeredTileIds(ctx: InsertionContext): UniqueSet<string> {
  const result = suggestTiles(ctx, catalogList(), services);
  const offered = new UniqueSet<string>();
  for (let i = 0; i < result.exact.size(); i++) offered.add(result.exact.get(i).tileDef.tileId);
  for (let i = 0; i < result.withConversion.size(); i++) offered.add(result.withConversion.get(i).tileDef.tileId);
  return offered;
}

function auditPosition(pos: Position, discrepancies: Discrepancy[]): void {
  const ctx = deriveContext(pos);
  const offered = offeredTileIds(ctx);
  const allTiles = services.edit.tiles.getAll();
  const conversions = services.shared.conversions;

  // Error-recovery positions offer everything by contract; the compiler
  // cannot meaningfully accept or reject additions to an already-broken
  // expression, so both directions are skipped.
  const expr = ctx.expr;
  if (expr !== undefined && expr.kind === "errorExpr") return;

  const report = (tileId: string, direction: "under-offer" | "over-offer", detail: string) => {
    discrepancies.push({ position: pos.key, tileId, direction, detail });
  };

  for (let ti = 0; ti < allTiles.size(); ti++) {
    const tile = allTiles.get(ti);
    const isOffered = offered.has(tile.tileId);

    if (isOffered) {
      // Gate self-consistency: an offered tile must satisfy the picker's own
      // gate contract regardless of compiler acceptance.
      if (hiddenFiltered(tile)) {
        report(tile.tileId, "over-offer", "hidden or deprecated tile offered");
        continue;
      }
      if (capabilityGateFiltered(tile, ctx)) {
        report(tile.tileId, "over-offer", "offered despite unmet capability requirement");
        continue;
      }
      if (outputGateFiltered(tile, ctx)) {
        report(tile.tileId, "over-offer", "output tile offered with no providing sensor in scope");
        continue;
      }
      if (whenResultGateFiltered(tile, ctx, conversions)) {
        report(tile.tileId, "over-offer", "WHEN-result consumer offered with no compatible WHEN result");
        continue;
      }
      if (factoryInstantiatesOnInsert(tile)) continue;
      if (tile.kind === "accessor") {
        if (!accessorInsertionAccepted(tile, pos)) {
          report(tile.tileId, "over-offer", "offered accessor is rejected by the compiler when inserted");
        }
        continue;
      }
      if (namedArgOfEnclosingCall(tile, pos)) continue;
      if (isAccessorBaseReplacement(pos) && isValueStartKind(tile)) continue;
      if (insertionAcceptance(pos, tile).status === "rejected") {
        if (isRootActionHeadReplacement(pos) || isParenReplacement(pos)) {
          if (prefixAcceptance(pos, tile).status !== "rejected") continue;
        }
        report(tile.tileId, "over-offer", "offered tile is rejected by the compiler when inserted");
      }
    } else {
      if (hiddenFiltered(tile)) continue;
      if (capabilityGateFiltered(tile, ctx)) continue;
      if (outputGateFiltered(tile, ctx)) continue;
      if (whenResultGateFiltered(tile, ctx, conversions)) continue;
      if (factoryInstantiatesOnInsert(tile)) continue;
      if (nilLiteralNeverOffered(tile)) continue;
      if (tile.kind === "accessor") {
        if (accessorInsertionAccepted(tile, pos)) {
          report(tile.tileId, "under-offer", "compiler accepts the accessor insertion but it is not offered");
        }
        continue;
      }
      const acceptance = insertionAcceptance(pos, tile);
      if (acceptance.status === "rejected") continue;
      if (operatorNeedsConversion(tile, acceptance)) continue;
      if (actuatorRescuedByReparse(tile, pos, acceptance)) continue;
      report(tile.tileId, "under-offer", `compiler accepts insertion (${acceptance.status}) but tile is not offered`);
    }
  }
}

// ---- Allowlist ----

/**
 * Known discrepancies, shrink-only. Every entry is a live finding grouped
 * under a one-line classification: the audit fails both on an unlisted
 * discrepancy and on a listed one that no longer reproduces (fixes must
 * delete their entries). Entry format: "position|tileId|direction".
 */
interface FindingClass {
  /** One-line classification of the finding group. */
  why: string;
  entries: readonly string[];
}

const KNOWN_DISCREPANCIES: readonly FindingClass[] = [];

function allowedEntryKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const cls of KNOWN_DISCREPANCIES) {
    for (const entry of cls.entries) keys.set(entry, cls.why);
  }
  return keys;
}

// ---- The audit ----

describe("suggestion-compiler consistency", () => {
  before(() => {
    services = __test__createBrainServices();
    registerProbeTiles();
  });

  test("picker offer set agrees with compiler acceptance across the corpus", () => {
    const discrepancies: Discrepancy[] = [];
    let positionCount = 0;
    const entries = corpus();
    for (const entry of entries) {
      for (const pos of enumeratePositions(entry)) {
        positionCount++;
        auditPosition(pos, discrepancies);
      }
    }

    // Coverage floors: a corpus or catalog that silently shrinks would make
    // the audit pass vacuously.
    assert.ok(entries.length >= 15, `corpus shrank to ${entries.length} brains`);
    assert.ok(positionCount >= 80, `position enumeration shrank to ${positionCount}`);
    assert.ok(services.edit.tiles.getAll().size() >= 40, "tile catalog shrank");

    const found = new Map<string, Discrepancy>();
    for (const d of discrepancies) {
      found.set(`${d.position}|${d.tileId}|${d.direction}`, d);
    }

    const allowed = allowedEntryKeys();
    const unexpected: string[] = [];
    for (const [key, d] of found) {
      if (!allowed.has(key)) unexpected.push(`"${key}",  // ${d.detail}`);
    }
    const stale: string[] = [];
    for (const key of allowed.keys()) {
      if (!found.has(key)) stale.push(key);
    }

    assert.deepEqual(unexpected, [], `Unlisted picker/compiler discrepancies found:\n${unexpected.join("\n")}`);
    assert.deepEqual(
      stale,
      [],
      `Allowlisted discrepancies no longer reproduce (remove their entries):\n${stale.join("\n")}`
    );
  });
});

// ---- Rule build outcome (shared by the pins and the validation tests) ----

interface RuleBuildOutcome {
  /** True when the link pipeline produced a program with no error diagnostics. */
  pipelineClean: boolean;
  /** Diagnostic codes of error-severity pipeline diagnostics. */
  pipelineErrorCodes: number[];
  /** Parse diagnostic codes reported by parseRule. */
  parseCodes: number[];
  /** Type diagnostic codes reported by parseRule. */
  typeCodes: number[];
  /** Every diagnostic message from both surfaces. */
  messages: string[];
}

function buildRule(when: IBrainTileDef[], doTiles: IBrainTileDef[]): RuleBuildOutcome {
  const { brain, rule } = newBrain("validation-probe");
  fill(rule, when, doTiles);
  const result = runBrainLinkPipeline(
    brain,
    { catalogs: catalogList(), actionResolver: services.runtime.actions, typeRegistry: services.runtime.types },
    services.shared.conversions
  );
  const outcome: RuleBuildOutcome = {
    pipelineClean: result.program !== undefined,
    pipelineErrorCodes: [],
    parseCodes: [],
    typeCodes: [],
    messages: [],
  };
  for (let i = 0; i < result.diagnostics.size(); i++) {
    const diag = result.diagnostics.get(i);
    outcome.messages.push(diag.message);
    if (diag.severity === "error") {
      outcome.pipelineClean = false;
      outcome.pipelineErrorCodes.push(diag.code as number);
    }
  }
  const parsed = parseRule(
    List.from(when),
    List.from(doTiles),
    catalogList(),
    services.shared.conversions,
    services.runtime.types
  );
  for (let i = 0; i < parsed.parseResult.diags.size(); i++) {
    const diag = parsed.parseResult.diags.get(i);
    outcome.parseCodes.push(diag.code as number);
    outcome.messages.push(diag.message);
  }
  for (let i = 0; i < parsed.typeInfo.diags.size(); i++) {
    const diag = parsed.typeInfo.diags.get(i);
    outcome.typeCodes.push(diag.code as number);
    outcome.messages.push(diag.message);
  }
  return outcome;
}

function compilesClean(when: IBrainTileDef[], doTiles: IBrainTileDef[]): boolean {
  const outcome = buildRule(when, doTiles);
  if (!outcome.pipelineClean) return false;
  if (outcome.parseCodes.length > 0) return false;
  for (const code of outcome.typeCodes) {
    if (code !== TypeDiagCode.DataTypeConverted) return false;
  }
  return true;
}

// ---- Compiler validation holes (pinned) ----
//
// Constructs the picker's gates exclude but the compiler accepts clean. Each
// is a compile-time validation gap in its own right; the audit above relies
// on the corresponding normalization rule, and these tests pin the gap so a
// compiler fix fails here and forces both the rule and this pin to be
// revisited. Fixes belong to separate slices. (Accessor/base pairing and
// rule-side placement are compiler-validated; see the next describe block.)

describe("compiler validation holes backing the normalization rules", () => {
  test("output tile compiles with no providing sensor in scope", () => {
    assert.ok(
      compilesClean([], [probeTiles.driveActuator, probeTiles.beaconOutput]),
      "output read without a provider is expected to compile clean today (validation hole)"
    );
  });

  test("WHEN-result consumer compiles with no WHEN result available", () => {
    assert.ok(
      compilesClean([], [probeTiles.replyActuator]),
      "WHEN-result consumer without a WHEN result is expected to compile clean today (validation hole)"
    );
  });

  test("capability-gated tile compiles with no capability provider", () => {
    assert.ok(
      compilesClean([], [probeTiles.driveActuator, probeTiles.gatedLit]),
      "capability-gated tile without its provider is expected to compile clean today (validation hole)"
    );
  });
});

// ---- Compiler-validated gate dimensions ----
//
// Accessor/base pairing and rule-side placement are validated by the compiler
// on both surfaces: parseRule reports the diagnostic, and the link pipeline
// rejects the brain with an error-severity diagnostic. The audit above relies
// on this: the accessor and placement dimensions are judged by compiler
// acceptance, not by re-deriving the picker's contract.

describe("compiler validation of accessor pairing and rule-side placement", () => {
  test("accessor on a base of a non-struct type is rejected", () => {
    const outcome = buildRule([], [probeTiles.numLit, probeTiles.accX]);
    assert.ok(
      outcome.typeCodes.includes(TypeDiagCode.AccessorBaseTypeMismatch),
      "parseRule reports AccessorBaseTypeMismatch"
    );
    assert.ok(
      outcome.pipelineErrorCodes.includes(TypeDiagCode.AccessorBaseTypeMismatch),
      "pipeline rejects with AccessorBaseTypeMismatch"
    );
    assert.ok(
      outcome.messages.some((m) => m.includes(`Field "x"`) && m.includes("ProbeVec") && m.includes("number")),
      "message names the field, its struct type, and the actual base type"
    );
  });

  test("accessor of a different struct type is rejected", () => {
    const outcome = buildRule([probeTiles.vecSensor, probeTiles.accRawX], []);
    assert.ok(
      outcome.typeCodes.includes(TypeDiagCode.AccessorBaseTypeMismatch),
      "parseRule reports AccessorBaseTypeMismatch"
    );
    assert.ok(
      outcome.pipelineErrorCodes.includes(TypeDiagCode.AccessorBaseTypeMismatch),
      "pipeline rejects with AccessorBaseTypeMismatch"
    );
    assert.ok(
      outcome.messages.some((m) => m.includes("ProbeRaw") && m.includes("ProbeVec")),
      "message names both struct types"
    );
  });

  test("tile placed on a rule side its placement excludes is rejected", () => {
    const doSideOnWhen = buildRule([probeTiles.beepActuator], []);
    assert.ok(
      doSideOnWhen.parseCodes.includes(ParseDiagCode.TilePlacementSideMismatch),
      "parseRule reports TilePlacementSideMismatch for a DO-side actuator on WHEN"
    );
    assert.ok(
      doSideOnWhen.pipelineErrorCodes.includes(ParseDiagCode.TilePlacementSideMismatch),
      "pipeline rejects a DO-side actuator on WHEN"
    );
    assert.ok(
      doSideOnWhen.messages.some((m) => m.includes(`"beep"`) && m.includes("WHEN")),
      "message names the tile and the side it appears on"
    );

    const whenSideOnDo = buildRule([], [probeTiles.seesSensor]);
    assert.ok(
      whenSideOnDo.parseCodes.includes(ParseDiagCode.TilePlacementSideMismatch),
      "parseRule reports TilePlacementSideMismatch for a WHEN-side sensor on DO"
    );
    assert.ok(
      whenSideOnDo.pipelineErrorCodes.includes(ParseDiagCode.TilePlacementSideMismatch),
      "pipeline rejects a WHEN-side sensor on DO"
    );
  });

  test("placeholder degradation still compiles: missing tiles trip neither validation", () => {
    const missing = new BrainTileMissingDef("probe.gone", "sensor", "gone");
    const outcome = buildRule([missing], [missing, probeTiles.accX]);
    assert.ok(outcome.pipelineClean, "a degraded rule still links to a program");
    const newCodes = [TypeDiagCode.AccessorBaseTypeMismatch as number, ParseDiagCode.TilePlacementSideMismatch];
    for (const code of newCodes) {
      assert.ok(!outcome.pipelineErrorCodes.includes(code), `pipeline does not emit ${code} for placeholders`);
      assert.ok(!outcome.parseCodes.includes(code), `parseRule does not emit ${code} for placeholders`);
      assert.ok(!outcome.typeCodes.includes(code), `parseRule does not emit ${code} for placeholders`);
    }
  });
});
