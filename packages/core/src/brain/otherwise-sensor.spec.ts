/**
 * Behavioral tests for the `otherwise` sensor: a zero-argument boolean sensor
 * that fires when the rule immediately above it at its own nesting level
 * evaluated its WHEN and did not fire.
 *
 * Each test builds a real BrainDef through the tile API and either runs it,
 * asserting which rules' DO sides executed, or reads the registered sensor body
 * against a seeded firing-record store. The compile-time validations are
 * asserted by diagnostic code, never by message prose.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { createHostActuator, createHostSensor, Dict, List, type ReadonlyList } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { CoreCapabilityBits, type IBrainTileDef, type ITileCatalog, TilePlacement } from "@wendoo/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { compileBrain, ParseDiagCode, runBrainLinkPipeline } from "@wendoo/core/brain/compiler";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import {
  type BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileSensorDef,
} from "@wendoo/core/brain/tiles";
import {
  BrainRuntime,
  CoreHostActions,
  CoreTypeIds,
  createProgramServices,
  createRuleFiringServices,
  type ExecutionContext,
  FALSE_VALUE,
  mkCallDef,
  mkNumberValue,
  mkSensorTileId,
  NIL_VALUE,
  type PageMetadata,
  type Program,
  RuleFiringState,
  type RuleFiringStates,
  TRUE_VALUE,
  type Value,
  VOID_VALUE,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";
import { BitSet } from "@wendoo/core/util";

let services: BrainServices;
let otherwiseTile: IBrainTileDef;
let opAnd: BrainTileOperatorDef;

/** Distinguishes the host ids each test registers; ids must be unique per registry. */
let hostIdCounter = 0;

before(() => {
  services = __test__createBrainServices();
  const tile = services.edit.tiles.get(mkSensorTileId(CoreHostActions.Otherwise.key));
  assert.ok(tile, "the otherwise sensor tile must be registered on the core catalog");
  otherwiseTile = tile;
  opAnd = new BrainTileOperatorDef("and", {}, services);
});

/** A marker actuator tile plus the list of ticks (1-based) on which it ran. */
interface Marker {
  tile: BrainTileActuatorDef;
  ticks: number[];
}

/** Registers a marker actuator that records the tick it ran on. */
function makeMarker(): Marker {
  hostIdCounter += 1;
  const ticks: number[] = [];
  const def = createHostActuator({
    key: `otherwise-marker-${hostIdCounter}`,
    actionId: 7300 + hostIdCounter,
    fnId: 8300 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    fn: {
      exec: (ctx: ExecutionContext) => {
        ticks.push(ctx.currentTick);
        return VOID_VALUE;
      },
    },
  });
  registerHost(def.function, def.descriptor, def.actionId, def.actionFn);
  return { tile: def.tile as BrainTileActuatorDef, ticks };
}

/**
 * Registers a presence-gated sensor whose delivered value the returned
 * `deliver` sets. A bare presence-gated sensor as a rule's whole WHEN fires the
 * rule on any delivered value, including a falsy one.
 */
function makePresenceGatedSensor(): { tile: BrainTileSensorDef; deliver: (v: Value) => void } {
  hostIdCounter += 1;
  const holder: { value: Value } = { value: NIL_VALUE };
  const def = createHostSensor({
    key: `otherwise-presence-${hostIdCounter}`,
    actionId: 7300 + hostIdCounter,
    fnId: 8300 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Number,
    fn: { exec: () => holder.value },
    capabilities: new BitSet().set(CoreCapabilityBits.PresenceGated),
  });
  registerHost(def.function, def.descriptor, def.actionId, def.actionFn);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
    capabilities: new BitSet().set(CoreCapabilityBits.PresenceGated),
  });
  services.edit.tiles.registerTileDef(tile);
  return {
    tile,
    deliver: (v: Value) => {
      holder.value = v;
    },
  };
}

/** Registers one host definition's function and action on the test services. */
function registerHost(
  fn: { id: number; name: string; isAsync: boolean; fn: unknown; callDef: unknown },
  descriptor: Parameters<typeof services.runtime.actions.register>[0]["descriptor"],
  actionId: number,
  actionFn: unknown
): void {
  services.runtime.functions.register(fn.id, fn.name, fn.isAsync, fn.fn as never, fn.callDef as never);
  services.runtime.actions.register({
    binding: "host",
    descriptor,
    id: actionId,
    execSync: (actionFn as { exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value }).exec,
  });
}

/**
 * Registers a WHEN-side boolean sensor that reads `true` and, on every
 * evaluation, records the firing record of the rule `watch` names.
 */
function makeRecordProbe(): { tile: BrainTileSensorDef; seen: RuleFiringState[]; watch: (funcId: number) => void } {
  hostIdCounter += 1;
  const seen: RuleFiringState[] = [];
  const subject = { funcId: -1 };
  const def = createHostSensor({
    key: `otherwise-record-probe-${hostIdCounter}`,
    actionId: 7300 + hostIdCounter,
    fnId: 8300 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Boolean,
    fn: {
      exec: (ctx: ExecutionContext) => {
        seen.push(ctx.services.brain.ruleFiring.get(subject.funcId));
        return TRUE_VALUE;
      },
    },
  });
  registerHost(def.function, def.descriptor, def.actionId, def.actionFn);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
  });
  services.edit.tiles.registerTileDef(tile);
  return {
    tile,
    seen,
    watch: (funcId: number) => {
      subject.funcId = funcId;
    },
  };
}

/**
 * Registers a WHEN-side boolean sensor tile declaring
 * {@link CoreCapabilityBits.RequiresPrecedingSiblingRule}, for asserting the
 * validation on a tile other than `otherwise`.
 */
function makePrecedingSiblingRequirer(): BrainTileSensorDef {
  hostIdCounter += 1;
  const def = createHostSensor({
    key: `otherwise-requirer-${hostIdCounter}`,
    actionId: 7300 + hostIdCounter,
    fnId: 8300 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    outputType: CoreTypeIds.Boolean,
    fn: { exec: () => TRUE_VALUE },
  });
  registerHost(def.function, def.descriptor, def.actionId, def.actionFn);
  const tile = new BrainTileSensorDef(def.descriptor.key, def.descriptor, {
    placement: TilePlacement.WhenSide | TilePlacement.Inline,
    capabilities: new BitSet().set(CoreCapabilityBits.RequiresPrecedingSiblingRule),
  });
  services.edit.tiles.registerTileDef(tile);
  return tile;
}

/** A boolean literal tile. */
function boolLiteral(b: boolean): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Boolean, b, {}, services);
}

/** A one-page brain whose first page is empty of rules beyond the default one. */
function newBrain(): { brainDef: BrainDef; page: BrainPageDef } {
  const brainDef = BrainDef.emptyBrainDef(services);
  return { brainDef, page: brainDef.pages().get(0)! as BrainPageDef };
}

/** Fills `rule`'s WHEN and DO sides from tile lists. */
function fillRule(rule: BrainRuleDef, whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): void {
  for (const tile of whenTiles) __test__appendTile(rule.when(), tile);
  for (const tile of doTiles) __test__appendTile(rule.do(), tile);
}

/** Compiles and runs `brainDef` for `ticks` thinks at a 16 ms cadence. */
function runBrain(brainDef: BrainDef, ticks = 1): void {
  const brain = brainDef.compile();
  brain.initialize();
  brain.startup();
  for (let i = 0; i < ticks; i++) {
    brain.think((i + 1) * 16);
  }
}

/** Every catalog the compiler needs for `brainDef`. */
function catalogsFor(brainDef: BrainDef): List<ITileCatalog> {
  return List.from([services.edit.tiles, brainDef.catalog()]);
}

/** Compiles, links, and treeshakes `brainDef` into the program a runtime loads. */
function linkBrain(brainDef: BrainDef): { program: Program; pages: List<PageMetadata> } {
  const result = runBrainLinkPipeline(
    brainDef,
    {
      catalogs: catalogsFor(brainDef),
      actionResolver: services.runtime.actions,
      typeRegistry: services.runtime.types,
    },
    services.shared.conversions
  );
  assert.ok(result.program, "the brain must compile and link");
  return { program: result.program.program, pages: result.program.pages };
}

/** The diagnostic codes `brainDef` compiles with. */
function compileDiagCodes(brainDef: BrainDef): number[] {
  const result = compileBrain(
    brainDef,
    catalogsFor(brainDef),
    services.shared.conversions,
    services.runtime.actions,
    services.runtime.types
  );
  const codes: number[] = [];
  for (let i = 0; i < result.diagnostics.size(); i++) {
    codes.push(result.diagnostics.get(i)!.code);
  }
  return codes;
}

describe("otherwise sensor -- the complement of the preceding sibling", () => {
  test("a subject that fires keeps the otherwise rule quiet", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [complement.tile]);

    runBrain(brainDef, 3);

    assert.deepEqual(subject.ticks, [1, 2, 3]);
    assert.deepEqual(complement.ticks, []);
  });

  test("a subject that does not fire runs the otherwise rule", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [complement.tile]);

    runBrain(brainDef, 3);

    assert.deepEqual(subject.ticks, []);
    assert.deepEqual(complement.ticks, [1, 2, 3]);
  });

  test("a presence-gated subject delivering a falsy value fires, so the otherwise rule stays quiet", () => {
    const { brainDef, page } = newBrain();
    const sensor = makePresenceGatedSensor();
    sensor.deliver(mkNumberValue(0));
    const subject = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [sensor.tile], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [complement.tile]);

    runBrain(brainDef, 2);

    assert.deepEqual(subject.ticks, [1, 2], "a delivered 0 fires the presence-gated rule");
    assert.deepEqual(complement.ticks, [], "the otherwise rule reads the gate outcome, not the value");
  });

  test("a presence-gated subject delivering nothing does not fire, so the otherwise rule runs", () => {
    const { brainDef, page } = newBrain();
    const sensor = makePresenceGatedSensor();
    sensor.deliver(NIL_VALUE);
    const subject = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [sensor.tile], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [complement.tile]);

    runBrain(brainDef, 2);

    assert.deepEqual(subject.ticks, []);
    assert.deepEqual(complement.ticks, [1, 2]);
  });

  test("an otherwise rule after an empty-WHEN rule never fires", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [complement.tile]);

    runBrain(brainDef, 3);

    assert.deepEqual(subject.ticks, [1, 2, 3], "an empty WHEN fires every think");
    assert.deepEqual(complement.ticks, []);
  });

  test("otherwise composed into a larger WHEN expression reads as an ordinary boolean", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const andTrue = makeMarker();
    const andFalse = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile, opAnd, boolLiteral(true)], [andTrue.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile, opAnd, boolLiteral(false)], [andFalse.tile]);

    runBrain(brainDef, 2);

    assert.deepEqual(subject.ticks, []);
    assert.deepEqual(andTrue.ticks, [1, 2], "otherwise AND true fires while the subject does not");
    assert.deepEqual(andFalse.ticks, [], "otherwise AND false never fires");
  });

  test("a flat run of otherwise rules alternates", () => {
    const { brainDef, page } = newBrain();
    const first = makeMarker();
    const second = makeMarker();
    const third = makeMarker();
    const fourth = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [first.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [second.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [third.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [fourth.tile]);

    runBrain(brainDef, 3);

    assert.deepEqual(first.ticks, [1, 2, 3]);
    assert.deepEqual(second.ticks, [], "rule 1 fired, so rule 2 stays quiet");
    assert.deepEqual(third.ticks, [1, 2, 3], "rule 2 did not fire, so rule 3 fires");
    assert.deepEqual(fourth.ticks, [], "rule 3 fired, so rule 4 stays quiet");
  });

  test("a nested else-if ladder selects exactly one branch per think", () => {
    const { brainDef, page } = newBrain();
    const branchA = makeMarker();
    const branchB = makeMarker();
    const branchC = makeMarker();

    // WHEN false DO a
    // WHEN otherwise
    //     WHEN false DO b
    //     WHEN otherwise DO c
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], [branchA.tile]);
    const elseRule = page.appendNewRule() as BrainRuleDef;
    fillRule(elseRule, [otherwiseTile], []);
    fillRule(elseRule.appendNewRule(), [boolLiteral(false)], [branchB.tile]);
    fillRule(elseRule.appendNewRule(), [otherwiseTile], [branchC.tile]);

    runBrain(brainDef, 4);

    assert.deepEqual(branchA.ticks, []);
    assert.deepEqual(branchB.ticks, []);
    assert.ok(branchC.ticks.length > 0, "the innermost else branch must run");
    assert.deepEqual(branchC.ticks, [1, 2, 3, 4], "child siblings evaluate in the same think their parent fires");
  });

  test("a nested else-if ladder takes the middle branch when its condition holds", () => {
    const { brainDef, page } = newBrain();
    const branchA = makeMarker();
    const branchB = makeMarker();
    const branchC = makeMarker();

    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], [branchA.tile]);
    const elseRule = page.appendNewRule() as BrainRuleDef;
    fillRule(elseRule, [otherwiseTile], []);
    fillRule(elseRule.appendNewRule(), [boolLiteral(true)], [branchB.tile]);
    fillRule(elseRule.appendNewRule(), [otherwiseTile], [branchC.tile]);

    runBrain(brainDef, 4);

    assert.deepEqual(branchA.ticks, []);
    assert.deepEqual(branchB.ticks, [1, 2, 3, 4]);
    assert.deepEqual(branchC.ticks, [], "the inner else stays quiet while its own sibling fires");
  });

  test("a child otherwise reads its own level, not the root level", () => {
    const { brainDef, page } = newBrain();
    const rootMarker = makeMarker();
    const onlyChild = makeMarker();

    // A single child under a firing root: the child is first at its level, so it
    // is invalid; instead give the root two children whose order is what counts.
    const root = page.children().get(0)! as BrainRuleDef;
    fillRule(root, [boolLiteral(true)], [rootMarker.tile]);
    fillRule(root.appendNewRule(), [boolLiteral(true)], []);
    fillRule(root.appendNewRule(), [otherwiseTile], [onlyChild.tile]);

    runBrain(brainDef, 4);

    assert.deepEqual(rootMarker.ticks, [1, 2, 3, 4]);
    assert.deepEqual(onlyChild.ticks, [], "the child's own preceding sibling fired every think");
  });
});

describe("otherwise sensor -- a subject part-way through its WHEN", () => {
  test("the sensor reads false while its subject is still evaluating", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], []);
    const { program, pages } = linkBrain(brainDef);
    const roots = pages.get(0)!.rootRuleFuncIds;
    const subjectFuncId = roots.get(0)!;

    const states: RuleFiringStates = new Dict();
    const context: ExecutionContext = {
      services: __test__createPlatformServices({
        program: createProgramServices(program, pages),
        ruleFiring: createRuleFiringServices(states),
      }),
      getVariableBySlot: () => NIL_VALUE,
      setVariableBySlot: () => {},
      getSystemVarBySlot: () => NIL_VALUE,
      setSystemVarBySlot: () => {},
      time: 0,
      dt: 0,
      currentTick: 0,
      currentRuleFuncId: roots.get(1)!,
    };
    const action = services.runtime.actions.getById(CoreHostActions.Otherwise.actionId);
    assert.ok(action?.binding === "host", "the otherwise sensor must be registered as a host action");
    const execSync = action.execSync;
    assert.ok(execSync, "the otherwise sensor must have a synchronous body");

    states.set(subjectFuncId, RuleFiringState.EVALUATING);
    assert.deepEqual(execSync(context, List.empty()), FALSE_VALUE);

    states.set(subjectFuncId, RuleFiringState.DID_NOT_FIRE);
    assert.deepEqual(execSync(context, List.empty()), TRUE_VALUE);

    states.set(subjectFuncId, RuleFiringState.DID_FIRE);
    assert.deepEqual(execSync(context, List.empty()), FALSE_VALUE);
  });
});

/**
 * Instruction budget per fiber slice for the split-WHEN runs below. The subject
 * rule {@link longWhenChain} builds compiles to 88 instructions, so 60 stops its
 * WHEN mid-evaluation on the first slice and completes it on the second, while
 * the `otherwise` rule's own 12-instruction body always fits in one slice.
 */
const SPLIT_SLICE_BUDGET = 60;

/** Twenty chained `and`s over boolean literals, the last of them `last`. */
function longWhenChain(last: boolean): IBrainTileDef[] {
  const tiles: IBrainTileDef[] = [boolLiteral(true)];
  for (let i = 0; i < 19; i++) {
    tiles.push(opAnd, boolLiteral(true));
  }
  tiles.push(opAnd, boolLiteral(last));
  return tiles;
}

/** What a {@link runSplitWhenPair} run observed. */
interface SplitWhenRun {
  /** Ticks the subject rule's DO side ran on. */
  subjectTicks: number[];
  /** Ticks the `otherwise` rule's DO side ran on. */
  complementTicks: number[];
  /** The subject's firing record as the `otherwise` rule's WHEN read it, one entry per evaluation. */
  subjectRecordPerEvaluation: RuleFiringState[];
}

/**
 * Runs `ticks` thinks at {@link SPLIT_SLICE_BUDGET} over two sibling rules: a
 * subject whose long WHEN ends in `subjectWhenEnds`, and an `otherwise` rule
 * whose WHEN reads the subject's firing record before the `otherwise` tile, so
 * every evaluation of that rule leaves an entry behind.
 */
function runSplitWhenPair(subjectWhenEnds: boolean, ticks: number): SplitWhenRun {
  const { brainDef, page } = newBrain();
  const subject = makeMarker();
  const complement = makeMarker();
  const probe = makeRecordProbe();

  fillRule(page.children().get(0)! as BrainRuleDef, longWhenChain(subjectWhenEnds), [subject.tile]);
  fillRule(page.appendNewRule() as BrainRuleDef, [probe.tile, opAnd, otherwiseTile], [complement.tile]);

  const { program, pages } = linkBrain(brainDef);
  const roots = pages.get(0)!.rootRuleFuncIds;
  probe.watch(roots.get(0)!);

  const runtime = new BrainRuntime(
    program,
    pages,
    { runtime: services.runtime, shared: services.shared, app: services.app },
    undefined,
    undefined,
    undefined,
    { defaultBudget: SPLIT_SLICE_BUDGET }
  );
  runtime.startup();
  for (let i = 0; i < ticks; i++) {
    runtime.think((i + 1) * 16);
  }

  return {
    subjectTicks: subject.ticks,
    complementTicks: complement.ticks,
    subjectRecordPerEvaluation: probe.seen,
  };
}

describe("otherwise sensor -- a subject whose WHEN outruns its instruction budget", () => {
  test("the otherwise rule evaluates and stays quiet on the think its subject's WHEN splits", () => {
    const run = runSplitWhenPair(true, 4);

    assert.deepEqual(run.subjectRecordPerEvaluation, [
      RuleFiringState.EVALUATING,
      RuleFiringState.DID_FIRE,
      RuleFiringState.EVALUATING,
      RuleFiringState.DID_FIRE,
    ]);
    assert.deepEqual(run.subjectTicks, [2, 4], "the subject's gate lands the think after its WHEN splits");
    assert.deepEqual(run.complementTicks, []);
  });

  test("the otherwise rule fires on the think a split subject's gate lands not-fired", () => {
    const run = runSplitWhenPair(false, 4);

    assert.deepEqual(run.subjectRecordPerEvaluation, [
      RuleFiringState.EVALUATING,
      RuleFiringState.DID_NOT_FIRE,
      RuleFiringState.EVALUATING,
      RuleFiringState.DID_NOT_FIRE,
    ]);
    assert.deepEqual(run.subjectTicks, []);
    assert.deepEqual(run.complementTicks, [2, 4], "the complement runs only on the thinks the gate landed");
  });
});

describe("otherwise sensor -- compile-time validation", () => {
  test("otherwise declares the preceding-sibling requirement the validation keys on", () => {
    assert.equal(otherwiseTile.capabilities().get(CoreCapabilityBits.RequiresPrecedingSiblingRule), 1);
  });

  test("any tile declaring the preceding-sibling requirement is rejected in the first rule at its level", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [makePrecedingSiblingRequirer()], [makeMarker().tile]);

    assert.ok(compileDiagCodes(brainDef).includes(ParseDiagCode.NoPrecedingSiblingRule));
  });

  test("otherwise in the first rule at its level is rejected", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [otherwiseTile], [makeMarker().tile]);

    assert.ok(compileDiagCodes(brainDef).includes(ParseDiagCode.NoPrecedingSiblingRule));
  });

  test("otherwise in the first child rule at its level is rejected", () => {
    const { brainDef, page } = newBrain();
    const root = page.children().get(0)! as BrainRuleDef;
    fillRule(root, [boolLiteral(true)], []);
    fillRule(root.appendNewRule(), [otherwiseTile], [makeMarker().tile]);

    assert.ok(compileDiagCodes(brainDef).includes(ParseDiagCode.NoPrecedingSiblingRule));
  });

  test("otherwise in a rule with a preceding sibling is accepted", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [makeMarker().tile]);

    assert.deepEqual(compileDiagCodes(brainDef), []);
  });

  test("otherwise on the DO side is rejected", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    const rule = page.appendNewRule() as BrainRuleDef;
    fillRule(rule, [boolLiteral(true)], [otherwiseTile]);

    assert.ok(compileDiagCodes(brainDef).includes(ParseDiagCode.TilePlacementSideMismatch));
  });

  test("otherwise inside a larger DO-side expression is rejected", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    const rule = page.appendNewRule() as BrainRuleDef;
    fillRule(rule, [boolLiteral(true)], [otherwiseTile, opAnd, boolLiteral(true)]);

    assert.ok(compileDiagCodes(brainDef).includes(ParseDiagCode.TilePlacementSideMismatch));
  });
});

describe("otherwise sensor -- the WHEN result", () => {
  test("a firing otherwise rule captures true as its WHEN result", () => {
    const { brainDef, page } = newBrain();
    hostIdCounter += 1;
    const captured: Value[] = [];
    const readerDef = createHostActuator({
      key: `otherwise-when-result-${hostIdCounter}`,
      actionId: 7300 + hostIdCounter,
      fnId: 8300 + hostIdCounter,
      callDef: mkCallDef({ type: "bag", items: [] }),
      fn: {
        exec: (ctx: ExecutionContext) => {
          captured.push(ctx.services.brain.ruleVars.getByName(ctx.currentRuleFuncId, "__whenResult"));
          return VOID_VALUE;
        },
      },
    });
    registerHost(readerDef.function, readerDef.descriptor, readerDef.actionId, readerDef.actionFn);

    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [readerDef.tile as BrainTileActuatorDef]);

    runBrain(brainDef, 1);

    assert.deepEqual(captured, [TRUE_VALUE]);
  });
});

describe("otherwise sensor -- registration", () => {
  test("the sensor's ids are the appended core ids", () => {
    assert.equal(CoreHostActions.Otherwise.actionId, 8);
    assert.equal(CoreHostActions.Otherwise.fnId, 106);
  });

  test("the tile is inline and WHEN-side only", () => {
    assert.equal(otherwiseTile.placement, TilePlacement.WhenSide | TilePlacement.Inline);
  });

  test("the sensor produces a boolean", () => {
    const sensorTile = otherwiseTile as BrainTileSensorDef;
    assert.equal(sensorTile.outputType, CoreTypeIds.Boolean);
    assert.equal(sensorTile.action.callDef.argSlots.size(), 0, "otherwise takes no arguments");
  });
});
