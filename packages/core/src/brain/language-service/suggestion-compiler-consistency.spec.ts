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
 *   by the compiler (or be a completable incomplete step).
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
import { List, type ReadonlyList, UniqueSet } from "@wendoo-lang/core";
import {
  type BrainServices,
  CoreControlFlowId,
  type IBrainRuleDef,
  type IBrainTileDef,
  type IBrainTileSet,
  type ITileCatalog,
  mkControlFlowTileId,
  mkOperatorTileId,
  RuleSide,
  TilePlacement,
} from "@wendoo-lang/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import type { Expr, ParseDiag } from "@wendoo-lang/core/brain/compiler";
import {
  type BrainBuildDiagnostic,
  collectProvidedCapabilities,
  collectProvidedOutputKeys,
  ParseDiagCode,
  parseRule,
  runBrainLinkPipeline,
  TypeDiagCode,
} from "@wendoo-lang/core/brain/compiler";
import {
  availableWhenResultType,
  countUnclosedParens,
  getTileOutputType,
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@wendoo-lang/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@wendoo-lang/core/brain/model";
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
} from "@wendoo-lang/core/brain/tiles";
import {
  bag,
  CoreHostActions,
  CoreOpId,
  CoreParameterId,
  CoreTypeIds,
  choice,
  type IConversionRegistry,
  mkActionDescriptor,
  mkCallDef,
  mkSensorTileId,
  mod,
  NIL_VALUE,
  optional,
  param,
  seq,
  TARGET_ACTION_ID_BASE,
  type TypeId,
  VOID_VALUE,
} from "@wendoo-lang/core/runtime";
import { BitSet } from "@wendoo-lang/core/util";

// ---- Services and probe tiles ----

let services: BrainServices;

/** Struct type with Number and String fields, with accessors. */
let vecTypeId: TypeId;
/** Struct type with a single Number field. */
let rawTypeId: TypeId;
/** Struct type with a Number field and a registered conversion to Buffer. */
let sigTypeId: TypeId;
/** Struct type whose only field is a struct: no primitive option reaches it. */
let opaqueTypeId: TypeId;

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
  /** Inline either-side Boolean sensor consuming a Number WHEN result. */
  echoSensor: BrainTileSensorDef;
  /** DO-side actuator: anonymous Number slot, optional named param, optional modifier. */
  driveActuator: BrainTileActuatorDef;
  drivePower: BrainTileParameterDef;
  driveMod: BrainTileModifierDef;
  /** DO-side actuator with no arguments. */
  beepActuator: BrainTileActuatorDef;
  /** Variable of the Buffer-convertible struct type. */
  sigVar: BrainTileVariableDef;
  /** Accessor for the Buffer-convertible struct's Number field. */
  accSigX: BrainTileAccessorDef;
  /** Inline no-arg value sensor returning the Buffer-convertible struct type. */
  sigSensor: BrainTileSensorDef;
  /** Variable of the struct type no choice option reaches. */
  opaqueVar: BrainTileVariableDef;
  /** DO-side actuator with one optional anonymous choice slot (Number, String, Boolean, or Buffer). */
  sendActuator: BrainTileActuatorDef;
  /** DO-side actuator with two anonymous Number slots sharing the anon Number arg tile. */
  steerActuator: BrainTileActuatorDef;
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
      metadata: { label: "gated 42" },
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

  const echoFn = fns.register(4109, "probe-echo", false, { exec: () => NIL_VALUE }, mkCallDef(bag()));
  probeTiles.echoSensor = new BrainTileSensorDef(
    "probe-echo",
    mkActionDescriptor("sensor", echoFn, CoreTypeIds.Boolean),
    {
      placement: TilePlacement.EitherSide | TilePlacement.Inline,
      metadata: { label: "echo" },
      consumesWhenResult: CoreTypeIds.Number,
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

  sigTypeId = types.addStructType("ProbeSig", {
    atomId: 20003,
    fields: List.from([{ name: "x", typeId: CoreTypeIds.Number, fieldIndex: 0 }]),
  });
  opaqueTypeId = types.addStructType("ProbeOpaque", {
    atomId: 20004,
    fields: List.from([{ name: "raw", typeId: rawTypeId, fieldIndex: 0 }]),
  });
  probeTiles.accSigX = new BrainTileAccessorDef(sigTypeId, "x", CoreTypeIds.Number, { metadata: { label: "sig x" } });
  probeTiles.sigVar = new BrainTileVariableDef("probe.sigVar", "sig", sigTypeId, "probe-var-sig");
  probeTiles.opaqueVar = new BrainTileVariableDef("probe.opaqueVar", "opaque", opaqueTypeId, "probe-var-opaque");

  const sigSensorFn = fns.register(4110, "probe-sig-read", false, { exec: () => NIL_VALUE }, mkCallDef(bag()));
  probeTiles.sigSensor = new BrainTileSensorDef(
    "probe-sig-read",
    mkActionDescriptor("sensor", sigSensorFn, sigTypeId),
    {
      placement: TilePlacement.EitherSide | TilePlacement.Inline,
      metadata: { label: "sig reading" },
    }
  );

  // Host-fn struct -> Buffer conversion, so choice fills of the sig type link
  // through the real pipeline.
  services.shared.conversions.register({
    id: 4210,
    fromType: sigTypeId,
    toType: CoreTypeIds.Buffer,
    cost: 2,
    fn: { exec: () => NIL_VALUE },
  });

  // The radio-send shape: one optional anonymous value slot over a choice of
  // Number, String, Boolean, and Buffer options.
  const bufferParam = new BrainTileParameterDef("probe.buffer", CoreTypeIds.Buffer, { hidden: true });
  tiles.registerTileDef(bufferParam);
  const sendFn = fns.register(
    4111,
    "probe-send",
    false,
    { exec: () => VOID_VALUE },
    mkCallDef(
      bag(
        optional(
          choice(
            param(CoreParameterId.AnonymousNumber, { anonymous: true }),
            param(CoreParameterId.AnonymousString, { anonymous: true }),
            param(CoreParameterId.AnonymousBoolean, { anonymous: true }),
            param("probe.buffer", { anonymous: true })
          )
        )
      )
    )
  );
  probeTiles.sendActuator = new BrainTileActuatorDef("probe-send", mkActionDescriptor("actuator", sendFn), {
    metadata: { label: "send" },
  });

  // Two required anonymous Number slots: both arg nodes reference the same
  // anon Number parameter tile, so the slots are distinguishable only by
  // their spec-node identity.
  const steerFn = fns.register(
    4112,
    "probe-steer",
    false,
    { exec: () => VOID_VALUE },
    mkCallDef(
      bag(
        param(CoreParameterId.AnonymousNumber, { name: "x", required: true, anonymous: true }),
        param(CoreParameterId.AnonymousNumber, { name: "y", required: true, anonymous: true })
      )
    )
  );
  probeTiles.steerActuator = new BrainTileActuatorDef("probe-steer", mkActionDescriptor("actuator", steerFn), {
    metadata: { label: "steer" },
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
    probeTiles.echoSensor,
    probeTiles.driveActuator,
    probeTiles.beepActuator,
    probeTiles.sigSensor,
    probeTiles.sendActuator,
    probeTiles.steerActuator,
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
  for (const t of when) __test__appendTile(rule.when(), t);
  for (const t of doTiles) __test__appendTile(rule.do(), t);
}

/** Appends a rule at the end of the brain's first page, at root level. */
function appendRootRule(brain: BrainDef): IBrainRuleDef {
  return brain.pages().get(0).appendNewRule()!;
}

/** The core `otherwise` sensor: a WHEN-side inline tile reading the rule above it. */
function otherwiseTile(): IBrainTileDef {
  return services.edit.tiles.get(mkSensorTileId(CoreHostActions.Otherwise.key))!;
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
      name: "capability-provider-child",
      build: () => {
        const { brain, rule } = newBrain("capability-provider-child");
        fill(rule, [t.beaconSensor], []);
        const child = rule.appendNewRule();
        fill(child, [], [t.driveActuator, t.gatedLit]);
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
      // A child with an empty WHEN: its DO consumer reads the ancestor's WHEN
      // result through the empty-WHEN fall-through.
      name: "when-result-empty-child",
      build: () => {
        const { brain, rule } = newBrain("when-result-empty-child");
        fill(rule, [t.numSensor], []);
        const child = rule.appendNewRule();
        fill(child, [], [t.replyActuator]);
        return brain;
      },
    },
    {
      // A child whose WHEN-side consumer reads the ancestor's WHEN result.
      name: "when-result-echo-child",
      build: () => {
        const { brain, rule } = newBrain("when-result-echo-child");
        fill(rule, [t.numSensor], []);
        const child = rule.appendNewRule();
        fill(child, [t.echoSensor], [t.beepActuator]);
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
    {
      name: "choice-slot-open",
      build: () => {
        const { brain, rule } = newBrain("choice-slot-open");
        fill(rule, [], [t.sendActuator]);
        return brain;
      },
    },
    {
      // A struct value in the choice slot, taken by the Buffer option through
      // the registered conversion.
      name: "choice-slot-convertible",
      build: () => {
        const { brain, rule } = newBrain("choice-slot-convertible");
        fill(rule, [], [t.sendActuator, t.sigVar]);
        return brain;
      },
    },
    {
      // The same convertible struct produced by an inline sensor.
      name: "choice-slot-convertible-sensor",
      build: () => {
        const { brain, rule } = newBrain("choice-slot-convertible-sensor");
        fill(rule, [], [t.sendActuator, t.sigSensor]);
        return brain;
      },
    },
    {
      // An exact option match in the choice slot.
      name: "choice-slot-exact",
      build: () => {
        const { brain, rule } = newBrain("choice-slot-exact");
        fill(rule, [], [t.sendActuator, t.strLit]);
        return brain;
      },
    },
    {
      // Two anonymous Number slots with a literal in the first: the second
      // slot's value tiles and the infix continuation are both legal.
      name: "two-anon-first-literal",
      build: () => {
        const { brain, rule } = newBrain("two-anon-first-literal");
        fill(rule, [], [t.steerActuator, t.numLit]);
        return brain;
      },
    },
    {
      // The first anonymous slot holds an accessor-refined inline-sensor
      // value ([vec reading][x] -> Number).
      name: "two-anon-first-accessor",
      build: () => {
        const { brain, rule } = newBrain("two-anon-first-accessor");
        fill(rule, [], [t.steerActuator, t.vecSensor, t.accX]);
        return brain;
      },
    },
    {
      // Both anonymous slots filled: only the infix continuation remains.
      name: "two-anon-complete",
      build: () => {
        const { brain, rule } = newBrain("two-anon-complete");
        fill(rule, [], [t.steerActuator, t.numLit, t.numLit]);
        return brain;
      },
    },
    {
      // Two root rules: the second has a rule above it, so a tile requiring a
      // preceding sibling is valid on its WHEN side and invalid on the first
      // rule's.
      name: "root-siblings-open-when",
      build: () => {
        const { brain, rule } = newBrain("root-siblings-open-when");
        fill(rule, [t.seesSensor], [t.beepActuator]);
        fill(appendRootRule(brain), [], [t.beepActuator]);
        return brain;
      },
    },
    {
      // A three-rule run whose middle rule's WHEN is `otherwise`: the third
      // rule's preceding sibling is itself an `otherwise` rule.
      name: "root-siblings-otherwise-run",
      build: () => {
        const { brain, rule } = newBrain("root-siblings-otherwise-run");
        fill(rule, [t.seesSensor], [t.beepActuator]);
        fill(appendRootRule(brain), [otherwiseTile()], [t.beepActuator]);
        fill(appendRootRule(brain), [], [t.beepActuator]);
        return brain;
      },
    },
    {
      // Both root rules hold a boolean conjunction on WHEN, so each operand is
      // a composed expression position -- audited once without a preceding
      // sibling and once with one.
      name: "root-siblings-when-conjunction",
      build: () => {
        const { brain, rule } = newBrain("root-siblings-when-conjunction");
        const and = services.edit.tiles.get(mkOperatorTileId(CoreOpId.And))!;
        fill(rule, [t.boolLit, and, t.boolLit], [t.beepActuator]);
        fill(appendRootRule(brain), [t.boolLit, and, t.boolLit], [t.beepActuator]);
        return brain;
      },
    },
    {
      // Two child rules under one parent: the preceding-sibling relation is
      // read at the children's own nesting level, not the root's.
      name: "child-siblings-open-when",
      build: () => {
        const { brain, rule } = newBrain("child-siblings-open-when");
        fill(rule, [t.seesSensor], []);
        fill(rule.appendNewRule(), [t.seesSensor], [t.beepActuator]);
        fill(rule.appendNewRule(), [], [t.beepActuator]);
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
 * Output identity keys visible to one side of a rule from the rest of the
 * hierarchy: the rule's other side plus every ancestor rule's WHEN and DO
 * sides. The judged side's own providers are collected by parseRule from the
 * tile list itself.
 */
function hierarchyProvidedKeysFor(rule: IBrainRuleDef, judgedSide: RuleSide): UniqueSet<string> {
  const keys = new UniqueSet<string>();
  const otherSide = judgedSide === RuleSide.When ? RuleSide.Do : RuleSide.When;
  collectProvidedOutputKeys(rule.side(otherSide).tiles(), keys);
  let ancestor = rule.ancestor();
  while (ancestor) {
    collectProvidedOutputKeys(ancestor.when().tiles(), keys);
    collectProvidedOutputKeys(ancestor.do().tiles(), keys);
    ancestor = ancestor.ancestor();
  }
  return keys;
}

/**
 * Capability bits visible to one side of a rule from the rest of the
 * hierarchy: the rule's other side plus every ancestor rule's WHEN and DO
 * sides. The judged side's own providers are collected by parseRule from the
 * tile list itself.
 */
function hierarchyCapabilitiesFor(rule: IBrainRuleDef, judgedSide: RuleSide): BitSet {
  let caps = new BitSet();
  const otherSide = judgedSide === RuleSide.When ? RuleSide.Do : RuleSide.When;
  caps = collectProvidedCapabilities(rule.side(otherSide).tiles(), caps);
  let ancestor = rule.ancestor();
  while (ancestor) {
    caps = collectProvidedCapabilities(ancestor.when().tiles(), caps);
    caps = collectProvidedCapabilities(ancestor.do().tiles(), caps);
    ancestor = ancestor.ancestor();
  }
  return caps;
}

/**
 * The WHEN-result type available to tiles on one side of a rule, derived from
 * the live rule tree the same way the picker and the compiler derive it.
 */
function whenResultAvailableFor(rule: IBrainRuleDef, side: RuleSide): TypeId | undefined {
  return availableWhenResultType(rule, side, services.edit.operatorOverloads, services.shared.conversions);
}

/** Stable memo-key text for a capability set: its set bit indices. */
function bitSetKey(bits: BitSet): string {
  if (bits.isEmpty()) return "";
  let key = "";
  const msb = bits.msb();
  for (let b = 0; b <= msb; b++) {
    if (bits.get(b) === 1) key += `${b},`;
  }
  return key;
}

/**
 * Parse + type-check verdict for one side's tile list, judged in isolation
 * (the other side does not constrain what the inserted tile may be) with the
 * hierarchy's provided output keys, capability bits, and available WHEN-result
 * type supplied for the output-provider, capability-requirement, and
 * WHEN-result checks.
 * "complete" means no diagnostics beyond informational conversions;
 * "incomplete" means only unfinished-expression diagnostics were produced
 * (type diagnostics are ignored: the unfinished tail cannot type-check, so
 * acceptance is decided by the completion search instead);
 * "invalid" means a structural or type error was reported.
 */
function sideVerdict(
  tiles: ReadonlyList<IBrainTileDef>,
  side: RuleSide,
  providedKeys: UniqueSet<string>,
  hierarchyCaps: BitSet,
  whenResult: TypeId | undefined
): SideVerdict {
  const key = `${side}|${providedKeys.toArray().sort().join(",")}|${bitSetKey(hierarchyCaps)}|wr:${
    whenResult ?? ""
  }|${tileListKey(tiles)}`;
  const memoized = verdictMemo.get(key);
  if (memoized !== undefined) return memoized;

  const empty = List.empty<IBrainTileDef>();
  const result =
    side === RuleSide.When
      ? parseRule(
          tiles,
          empty,
          catalogList(),
          services.shared.conversions,
          services.runtime.types,
          services.app.localizer,
          providedKeys,
          hierarchyCaps,
          whenResult,
          services.edit.operatorOverloads
        )
      : parseRule(
          empty,
          tiles,
          catalogList(),
          services.shared.conversions,
          services.runtime.types,
          services.app.localizer,
          providedKeys,
          hierarchyCaps,
          whenResult,
          services.edit.operatorOverloads
        );
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
    probeTiles.sigVar,
    probeTiles.accX,
    probeTiles.accLabel,
    probeTiles.accRawX,
    probeTiles.accSigX,
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

/** Visit every rule side in the brain, walking pages and child rules. */
function forEachRuleSide(brain: BrainDef, visit: (rule: IBrainRuleDef, side: RuleSide) => void): void {
  const walkRule = (rule: IBrainRuleDef) => {
    visit(rule, RuleSide.When);
    visit(rule, RuleSide.Do);
    const children = rule.children();
    for (let i = 0; i < children.size(); i++) walkRule(children.get(i));
  };
  const pages = brain.pages();
  for (let p = 0; p < pages.size(); p++) {
    const rules = pages.get(p).children();
    for (let r = 0; r < rules.size(); r++) walkRule(rules.get(r));
  }
}

/**
 * Full compile + link + treeshake acceptance for the position's brain with
 * the mutated side applied, catching codegen- and link-level rejections.
 * Every other rule side that does not parse complete -- captured mid-edit, or
 * with its output provider removed by the probe -- is temporarily cleared: its
 * diagnostic belongs to that side, not to the inserted tile, so it must not
 * veto the probe. Clearing repeats until stable, since a cleared side also
 * stops providing output keys.
 */
function pipelineAccepts(pos: Position, mutated: ReadonlyList<IBrainTileDef>): boolean {
  const key = `${pos.ruleKey}|${sideName(pos.side)}|${tileListKey(mutated)}`;
  const memoized = pipelineMemo.get(key);
  if (memoized !== undefined) return memoized;

  const tileSet = pos.rule.side(pos.side);
  const original = copyTiles(tileSet.tiles());
  setSideTiles(tileSet, mutated);

  const clearedSides: Array<{ set: IBrainTileSet; original: List<IBrainTileDef> }> = [];
  let changed = true;
  while (changed) {
    changed = false;
    forEachRuleSide(pos.brain, (rule, side) => {
      if (rule === pos.rule && side === pos.side) return;
      const set = rule.side(side);
      if (set.tiles().size() === 0) return;
      const verdict = sideVerdict(
        set.tiles(),
        side,
        hierarchyProvidedKeysFor(rule, side),
        hierarchyCapabilitiesFor(rule, side),
        whenResultAvailableFor(rule, side)
      ).verdict;
      if (verdict !== "complete") {
        clearedSides.push({ set, original: copyTiles(set.tiles()) });
        setSideTiles(set, List.empty<IBrainTileDef>());
        changed = true;
      }
    });
  }

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
  for (const cleared of clearedSides) setSideTiles(cleared.set, cleared.original);

  pipelineMemo.set(key, accepted);
  return accepted;
}

function setSideTiles(tileSet: IBrainTileSet, tiles: ReadonlyList<IBrainTileDef>): void {
  while (tileSet.tiles().size() > 0) tileSet.removeTileAtIndex(0);
  for (let i = 0; i < tiles.size(); i++) __test__appendTile(tileSet, tiles.get(i));
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
  const providedKeys = hierarchyProvidedKeysFor(pos.rule, pos.side);
  const hierarchyCaps = hierarchyCapabilitiesFor(pos.rule, pos.side);
  const whenResult = whenResultAvailableFor(pos.rule, pos.side);
  let v = sideVerdict(list, pos.side, providedKeys, hierarchyCaps, whenResult);
  if (v.verdict === "incomplete") {
    const depth = countUnclosedParens(list);
    if (depth > 0) {
      const closeParen = services.edit.tiles.get(mkControlFlowTileId(CoreControlFlowId.CloseParen))!;
      const drained = copyTiles(list);
      for (let i = 0; i < depth; i++) drained.push(closeParen);
      v = sideVerdict(drained, pos.side, providedKeys, hierarchyCaps, whenResult);
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
  const providedKeys = hierarchyProvidedKeysFor(pos.rule, pos.side);
  const hierarchyCaps = hierarchyCapabilitiesFor(pos.rule, pos.side);
  const whenResult = whenResultAvailableFor(pos.rule, pos.side);
  const direct = sideVerdict(mutated, pos.side, providedKeys, hierarchyCaps, whenResult);
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
      } else if (sideVerdict(mutated, pos.side, providedKeys, hierarchyCaps, whenResult).verdict === "incomplete") {
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
 *
 * An inserted open paren gets a second witness with its group seeded closed
 * (`( 7 )`): the group alone consumes the two-tile completion depth, so a
 * position whose remaining slots need further tiles would otherwise be
 * judged rejected.
 */
function insertionAcceptance(pos: Position, tile: IBrainTileDef): Acceptance {
  const mutated = mutatedSide(pos, tile);
  const afterTile = (pos.replaceIndex ?? mutated.size() - 1) + 1;
  const points = afterTile === mutated.size() ? [afterTile] : [afterTile, mutated.size()];
  const direct = listAcceptance(pos, mutated, points);
  if (direct.status !== "rejected") return direct;
  if (tile.tileId === mkControlFlowTileId(CoreControlFlowId.OpenParen)) {
    const closeParen = services.edit.tiles.get(mkControlFlowTileId(CoreControlFlowId.CloseParen))!;
    const seeded = mutatedSide(pos, tile);
    seeded.insert(afterTile, probeTiles.numLit);
    seeded.insert(afterTile + 1, closeParen);
    return listAcceptance(pos, seeded, [seeded.size()]);
  }
  return direct;
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
      ? parseRule(
          tiles,
          empty,
          catalogList(),
          services.shared.conversions,
          services.runtime.types,
          services.app.localizer
        )
      : parseRule(
          empty,
          tiles,
          catalogList(),
          services.shared.conversions,
          services.runtime.types,
          services.app.localizer
        );
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

/** True for tiles the picker offers as value-expression starts: value tiles and the open paren (a grouped value start). */
function isValueStartTile(tile: IBrainTileDef): boolean {
  return (
    tile.kind === "literal" ||
    tile.kind === "variable" ||
    tile.kind === "output" ||
    tile.kind === "sensor" ||
    tile.tileId === mkControlFlowTileId(CoreControlFlowId.OpenParen)
  );
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
      if (factoryInstantiatesOnInsert(tile)) continue;
      if (tile.kind === "accessor") {
        if (!accessorInsertionAccepted(tile, pos)) {
          report(tile.tileId, "over-offer", "offered accessor is rejected by the compiler when inserted");
        }
        continue;
      }
      if (namedArgOfEnclosingCall(tile, pos)) continue;
      if (isAccessorBaseReplacement(pos) && isValueStartTile(tile)) continue;
      if (insertionAcceptance(pos, tile).status === "rejected") {
        if (isRootActionHeadReplacement(pos) || isParenReplacement(pos)) {
          if (prefixAcceptance(pos, tile).status !== "rejected") continue;
        }
        report(tile.tileId, "over-offer", "offered tile is rejected by the compiler when inserted");
      }
    } else {
      if (hiddenFiltered(tile)) continue;
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
  /** Parse diagnostics reported by parseRule, in report order. */
  parseDiags: ParseDiag[];
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
    parseDiags: [],
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
    services.runtime.types,
    services.app.localizer,
    undefined,
    undefined,
    undefined,
    services.edit.operatorOverloads
  );
  for (let i = 0; i < parsed.parseResult.diags.size(); i++) {
    const diag = parsed.parseResult.diags.get(i);
    outcome.parseCodes.push(diag.code as number);
    outcome.parseDiags.push(diag);
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

// ---- Compiler-validated gate dimensions ----
//
// Accessor/base pairing, rule-side placement, output providers, capability
// requirements, and WHEN-result consumption are validated by the compiler on
// both surfaces: parseRule reports the diagnostic, and the link pipeline
// rejects the brain with an error-severity diagnostic. The audit above relies
// on this: every gate dimension is judged by compiler acceptance, not by
// re-deriving the picker's contract.

describe("compiler validation of accessor pairing, placement, output providers, capability requirements, and WHEN-result consumers", () => {
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

  test("output tile with no providing sensor in scope is rejected", () => {
    const outcome = buildRule([], [probeTiles.driveActuator, probeTiles.beaconOutput]);
    assert.ok(
      outcome.parseCodes.includes(ParseDiagCode.OutputTileMissingProvider),
      "parseRule reports OutputTileMissingProvider"
    );
    assert.ok(
      outcome.pipelineErrorCodes.includes(ParseDiagCode.OutputTileMissingProvider),
      "pipeline rejects with OutputTileMissingProvider"
    );
    assert.ok(
      outcome.messages.some((m) => m.includes(`"signal"`) && m.includes("no providing action")),
      "message names the output tile and the missing provider"
    );
  });

  test("output tile with its providing sensor in the same rule compiles", () => {
    assert.ok(
      compilesClean([probeTiles.beaconSensor], [probeTiles.driveActuator, probeTiles.beaconOutput]),
      "an output paired with its declaring sensor compiles clean"
    );
  });

  test("output tile with its providing sensor in an ancestor rule compiles", () => {
    const { brain, rule } = newBrain("ancestor-provider");
    fill(rule, [probeTiles.beaconSensor], []);
    const child = rule.appendNewRule();
    fill(child, [], [probeTiles.driveActuator, probeTiles.beaconOutput]);
    const result = runBrainLinkPipeline(
      brain,
      { catalogs: catalogList(), actionResolver: services.runtime.actions, typeRegistry: services.runtime.types },
      services.shared.conversions
    );
    assert.ok(result.program !== undefined, "the pipeline produces a program");
    for (let i = 0; i < result.diagnostics.size(); i++) {
      assert.notEqual(result.diagnostics.get(i).severity, "error", result.diagnostics.get(i).message);
    }
  });

  test("capability-gated tile with no provider in scope is rejected", () => {
    const outcome = buildRule([], [probeTiles.driveActuator, probeTiles.gatedLit]);
    assert.ok(
      outcome.parseCodes.includes(ParseDiagCode.TileRequirementsNotProvided),
      "parseRule reports TileRequirementsNotProvided"
    );
    assert.ok(
      outcome.pipelineErrorCodes.includes(ParseDiagCode.TileRequirementsNotProvided),
      "pipeline rejects with TileRequirementsNotProvided"
    );
    const gated = outcome.parseDiags.find((d) => d.code === ParseDiagCode.TileRequirementsNotProvided);
    assert.equal(gated?.params?.tileId, probeTiles.gatedLit.tileId, "the diagnostic names the gated tile");
    assert.ok(
      gated?.params?.providerTileIds?.toArray().includes(probeTiles.beaconSensor.tileId),
      "the diagnostic suggests the providing sensor"
    );
  });

  test("capability-gated tile with its provider in the same rule compiles", () => {
    assert.ok(
      compilesClean([probeTiles.beaconSensor], [probeTiles.driveActuator, probeTiles.gatedLit]),
      "a gated tile paired with its capability provider compiles clean"
    );
  });

  test("capability-gated tile with its provider in an ancestor rule compiles", () => {
    const { brain, rule } = newBrain("ancestor-capability-provider");
    fill(rule, [probeTiles.beaconSensor], []);
    const child = rule.appendNewRule();
    fill(child, [], [probeTiles.driveActuator, probeTiles.gatedLit]);
    const result = runBrainLinkPipeline(
      brain,
      { catalogs: catalogList(), actionResolver: services.runtime.actions, typeRegistry: services.runtime.types },
      services.shared.conversions
    );
    assert.ok(result.program !== undefined, "the pipeline produces a program");
    for (let i = 0; i < result.diagnostics.size(); i++) {
      assert.notEqual(result.diagnostics.get(i).severity, "error", result.diagnostics.get(i).message);
    }
  });

  test("WHEN-result consumer with no WHEN result available is rejected", () => {
    const outcome = buildRule([], [probeTiles.replyActuator]);
    assert.ok(
      outcome.parseCodes.includes(ParseDiagCode.TileWhenResultUnavailable),
      "parseRule reports TileWhenResultUnavailable"
    );
    assert.ok(
      outcome.pipelineErrorCodes.includes(ParseDiagCode.TileWhenResultUnavailable),
      "pipeline rejects with TileWhenResultUnavailable"
    );
    assert.ok(
      outcome.messages.some((m) => m.includes(`"reply"`) && m.includes("WHEN")),
      "message names the consumer tile and the WHEN result it needs"
    );
  });

  test("WHEN-result consumer under an incompatible WHEN result is rejected", () => {
    const outcome = buildRule([probeTiles.numSensor], [probeTiles.vecReplyActuator]);
    assert.ok(
      outcome.parseCodes.includes(ParseDiagCode.TileWhenResultUnavailable),
      "parseRule reports TileWhenResultUnavailable"
    );
    assert.ok(
      outcome.pipelineErrorCodes.includes(ParseDiagCode.TileWhenResultUnavailable),
      "pipeline rejects with TileWhenResultUnavailable"
    );
    assert.ok(
      outcome.messages.some((m) => m.includes(`"vec reply"`) && m.includes("ProbeVec")),
      "message names the consumer tile and the required result type"
    );
  });

  test("WHEN-result consumer on a root rule's WHEN side is rejected", () => {
    const outcome = buildRule([probeTiles.echoSensor], [probeTiles.beepActuator]);
    assert.ok(
      outcome.parseCodes.includes(ParseDiagCode.TileWhenResultUnavailable),
      "parseRule reports TileWhenResultUnavailable for a WHEN-side consumer with no enclosing rule"
    );
    assert.ok(
      outcome.pipelineErrorCodes.includes(ParseDiagCode.TileWhenResultUnavailable),
      "pipeline rejects a WHEN-side consumer with no enclosing rule"
    );
  });

  test("WHEN-result consumer with its own compatible WHEN result compiles", () => {
    assert.ok(
      compilesClean([probeTiles.numSensor], [probeTiles.replyActuator]),
      "a DO-side consumer under its own compatible WHEN compiles clean"
    );
  });

  test("WHEN-result consumer under a WHEN result converting to its type compiles", () => {
    assert.ok(
      compilesClean([probeTiles.seesSensor], [probeTiles.replyActuator]),
      "a Number consumer under a Boolean WHEN compiles through the Boolean -> Number conversion"
    );
  });

  test("an ancestor's WHEN result satisfies a child rule's consumers on both sides", () => {
    const { brain, rule } = newBrain("ancestor-when-result");
    fill(rule, [probeTiles.numSensor], []);
    const whenChild = rule.appendNewRule();
    fill(whenChild, [probeTiles.echoSensor], [probeTiles.beepActuator]);
    const doChild = rule.appendNewRule();
    fill(doChild, [], [probeTiles.replyActuator]);
    const result = runBrainLinkPipeline(
      brain,
      { catalogs: catalogList(), actionResolver: services.runtime.actions, typeRegistry: services.runtime.types },
      services.shared.conversions
    );
    assert.ok(result.program !== undefined, "the pipeline produces a program");
    for (let i = 0; i < result.diagnostics.size(); i++) {
      assert.notEqual(result.diagnostics.get(i).severity, "error", result.diagnostics.get(i).message);
    }
  });

  test("placeholder degradation still compiles: missing tiles trip no validation", () => {
    const missing = new BrainTileMissingDef("probe.gone", "sensor", "gone");
    const missingOutput = new BrainTileMissingDef("tile.out->number:<number>.gone", "out", "gone output");
    const outcome = buildRule([missing], [missing, probeTiles.accX, missingOutput]);
    assert.ok(outcome.pipelineClean, "a degraded rule still links to a program");
    const validationCodes = [
      TypeDiagCode.AccessorBaseTypeMismatch as number,
      ParseDiagCode.TilePlacementSideMismatch,
      ParseDiagCode.OutputTileMissingProvider,
      ParseDiagCode.TileRequirementsNotProvided,
      ParseDiagCode.TileWhenResultUnavailable,
    ];
    for (const code of validationCodes) {
      assert.ok(!outcome.pipelineErrorCodes.includes(code), `pipeline does not emit ${code} for placeholders`);
      assert.ok(!outcome.parseCodes.includes(code), `parseRule does not emit ${code} for placeholders`);
      assert.ok(!outcome.typeCodes.includes(code), `parseRule does not emit ${code} for placeholders`);
    }
  });
});
