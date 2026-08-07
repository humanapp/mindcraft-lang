import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { __test__appendTile } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileActuatorDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import {
  type BrainActionCallDef,
  bag,
  CoreTypeIds,
  mkActionDescriptor,
  mkCallDef,
  mod,
  NIL_VALUE,
  optional,
} from "@mindcraft-lang/core/runtime";
import { createElement, Fragment } from "react";
import { type CandidateStripSurfaceOptions, useCandidateStripSurface } from "./BrainCandidateStrip";

/** Tile id of the object modifier a fixture sensor's object slot accepts. */
const kObjectModifierId = "fixture-mod-object";

let nextFnId = 5600;

/** Register a host function for `tileId` on `services` and return its entry. */
function registerFn(services: BrainServices, tileId: string, callDef: BrainActionCallDef) {
  const fnId = nextFnId;
  nextFnId += 1;
  return services.runtime.functions.register(fnId, `${tileId}#${fnId}`, false, { exec: () => NIL_VALUE }, callDef);
}

/**
 * A boolean sensor tile whose call spec declares no argument slot, so its
 * sentence reads one word for it.
 */
export function makeSensor(services: BrainServices, sensorId: string): BrainTileSensorDef {
  const fnEntry = registerFn(services, sensorId, mkCallDef(bag()));
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: sensorId },
  });
}

/**
 * A boolean sensor tile whose one optional slot takes an object modifier, so a
 * bare placement of it reads with its frame's completion word and the sentence
 * reads two words for the one tile.
 */
export function makeObjectSensor(services: BrainServices, sensorId: string): BrainTileSensorDef {
  const fnEntry = registerFn(services, sensorId, mkCallDef(bag(optional(mod(kObjectModifierId)))));
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: sensorId },
  });
}

/**
 * A boolean sensor tile reading in the adverb frame, whose word is the whole
 * trigger when it stands alone on a WHEN side, so the sentence opens on it.
 */
export function makeAdverbSensor(services: BrainServices, sensorId: string, form: string): BrainTileSensorDef {
  const fnEntry = registerFn(services, sensorId, mkCallDef(bag()));
  return new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
    metadata: { label: form, language: { form, frame: "adverb" } },
  });
}

/** An actuator tile whose call spec declares no argument slot. */
export function makeActuator(services: BrainServices, actuatorId: string): BrainTileActuatorDef {
  const fnEntry = registerFn(services, actuatorId, mkCallDef(bag()));
  return new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {
    metadata: { label: actuatorId },
  });
}

/** An actuator tile whose action is async, so a placement of it carries the badge for work that may take time. */
export function makeAsyncActuator(services: BrainServices, actuatorId: string): BrainTileActuatorDef {
  const fnId = nextFnId;
  nextFnId += 1;
  const fnEntry = services.runtime.functions.register(
    fnId,
    `${actuatorId}#${fnId}`,
    true,
    { exec: () => NIL_VALUE },
    mkCallDef(bag())
  );
  return new BrainTileActuatorDef(actuatorId, mkActionDescriptor("actuator", fnEntry), {
    metadata: { label: actuatorId },
  });
}

/**
 * Both pieces of the candidate strip in one element, in the order a rule card
 * places them: the input the sentence line hosts, then the offering panel. The
 * offering comes from `options.state`, so a spec can supply it directly.
 */
export function StripSurface(options: CandidateStripSurfaceOptions) {
  const surface = useCandidateStripSurface(options);
  return createElement(Fragment, null, surface.composerInput, surface.panel);
}

/** An empty brain whose page's first rule holds `whenTiles` and `doTiles`. */
export function makeBrain(
  services: BrainServices,
  whenTiles: readonly IBrainTileDef[],
  doTiles: readonly IBrainTileDef[]
) {
  const brainDef = BrainDef.emptyBrainDef(services);
  const pageDef = brainDef.pages().get(0) as BrainPageDef;
  const ruleDef = pageDef.children().get(0) as BrainRuleDef;
  for (const tileDef of whenTiles) __test__appendTile(ruleDef.when(), tileDef);
  for (const tileDef of doTiles) __test__appendTile(ruleDef.do(), tileDef);
  return { brainDef, pageDef, ruleDef };
}
