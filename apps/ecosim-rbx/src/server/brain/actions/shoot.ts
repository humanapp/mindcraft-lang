import {
  type BrainTileOutputDef,
  bag,
  buildDescriptorOutputTiles,
  CoreTypeIds,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  isNumberValue,
  logger,
  mkCallDef,
  type NumberValue,
  optional,
  type ParameterTileInput,
  param,
  type ReadonlyList,
  setCallSiteState,
  setSensorOutput,
  TRUE_VALUE,
  type Value,
} from "@wendoo-lang/core/app";
import { EcosimHostActions } from "../abi-ids";
import { getSelf } from "../execution-context-types";
import { TileIds } from "../tileids";
import { EcosimTypeIds } from "../type-system";
import { resolveTargetActor } from "./utils";

const AnonActorRef = param(TileIds.Parameter.AnonymousActorRef, {
  anonymous: true,
});
const Rate = param(TileIds.Parameter.Rate);

const callDef = mkCallDef(bag(optional(AnonActorRef), optional(Rate)));

const kAnonActorRefSlotId = getSlotId(callDef, AnonActorRef);
const kRateSlotId = getSlotId(callDef, Rate);

/** Default ms between consecutive shots from the same call-site. */
const DEFAULT_SHOOT_RATE = 2; // shots per second
const MAX_SHOOT_RATE = 5; // shots per second
const MIN_SHOOT_RATE = 0; // shots per second

/** Energy cost to fire a single blip. */
const SHOOT_ENERGY_COST = 5;

/**
 * Recoil impulse magnitude (mass * px/s) applied to the shooter opposite the blip.
 * Divided by body mass to get the resulting velocity change, so heavier actors
 * recoil less. Plants route this through PlantComp.applyImpulse() so the spring
 * integrator picks it up (PlantComp.physicsTick() zeros horizontal velocity each frame).
 */
const SHOOT_KICKBACK_IMPULSE = 1.5;

/** Output name reporting whether the call just made put a blip into flight. */
const SHOT_FIRED_OUTPUT = "shot fired";

/** The named outputs the `shoot` actuator exposes. */
const outputs = [
  {
    name: SHOT_FIRED_OUTPUT,
    type: CoreTypeIds.Boolean,
    label: "the shot fired",
  },
] satisfies NonNullable<CreateHostActuatorOptions["outputs"]>;

/** Inline output value-tiles the `shoot` actuator exposes; register them alongside it. */
export const outputTiles: readonly BrainTileOutputDef[] = buildDescriptorOutputTiles(outputs);

type ShootState = {
  nextShootTime: number;
};

function initShoot(ctx: ExecutionContext): void {
  setCallSiteState(ctx, { nextShootTime: 0 } satisfies ShootState);
}

/**
 * Put one blip into flight, or decline to. Declines when there is no acting
 * actor, while the call-site's cooldown is still running, when the shooter
 * cannot pay the shot's energy, when the resolved target sits on top of the
 * shooter, and when the world's blip pool is exhausted.
 */
function launchBlip(ctx: ExecutionContext, args: ReadonlyList<Value>): boolean {
  try {
    const selfActor = getSelf(ctx);
    if (!selfActor) return false;

    const now = selfActor.engine.simTime;
    const state = getCallSiteState<ShootState>(ctx)!;

    if (now < state.nextShootTime) return false;

    let cooldown = 1000 / DEFAULT_SHOOT_RATE; // Default cooldown in ms
    const rateValue = args.at(kRateSlotId) as NumberValue | undefined;
    if (rateValue && isNumberValue(rateValue)) {
      const rate = math.max(MIN_SHOOT_RATE, math.min(MAX_SHOOT_RATE, rateValue.v));
      cooldown = 1000 / rate;
    }

    const target = resolveTargetActor(ctx, args, kAnonActorRefSlotId);

    // Drain energy from the shooter to pay for the shot. If they can't afford it, abort.
    if (selfActor.energy < SHOOT_ENERGY_COST) return false;
    selfActor.drainEnergy(SHOOT_ENERGY_COST);

    // Compute direction: toward the target if one exists, otherwise shoot forward.
    let dirX: number;
    let dirY: number;
    if (target) {
      const dx = target.sprite.x - selfActor.sprite.x;
      const dy = target.sprite.y - selfActor.sprite.y;
      const dist = math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return false;
      dirX = dx / dist;
      dirY = dy / dist;
    } else {
      const angle = selfActor.sprite.rotation;
      dirX = math.cos(angle);
      dirY = math.sin(angle);
    }

    // Delegate the actual blip creation to the engine (may fail at cap)
    const blip = selfActor.engine.spawnBlip(selfActor.actorId, selfActor.sprite.x, selfActor.sprite.y, dirX, dirY);
    if (!blip) return false;

    // Apply kickback: velocity impulse in the opposite direction of the blip.
    const body = selfActor.sprite.body;
    if (body) {
      const dv = SHOOT_KICKBACK_IMPULSE / body.mass;
      const kickX = -dirX * dv;
      const kickY = -dirY * dv;
      if (selfActor.plantComp) {
        // Plant spring integrator zeroes horizontal velocity every tick; inject
        // the kickback directly into the spring velocity instead.
        selfActor.plantComp.applyImpulse(kickX * 10, kickY * 10);
      } else {
        selfActor.sprite.setVelocity(body.velocity.x + kickX, body.velocity.y + kickY);
      }
    }

    state.nextShootTime = now + cooldown;

    return true;
  } catch (error) {
    logger.error("Error executing shoot action:", error);
    return false;
  }
}

/**
 * Fire a blip and report whether it went out. Returns TRUE when a blip was put
 * into flight and FALSE otherwise, and writes the same verdict to the
 * actuator's `shot fired` output, which the rule holding the call and every
 * rule below it can read.
 */
export function execShoot(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  const fired = launchBlip(ctx, args) ? TRUE_VALUE : FALSE_VALUE;
  setSensorOutput(ctx, CoreTypeIds.Boolean, SHOT_FIRED_OUTPUT, fired);
  return fired;
}

export default {
  ...EcosimHostActions.Shoot,
  callDef,
  fn: { onInitialized: initShoot, exec: execShoot },
  isAsync: false,
  outputs,
  metadata: { label: "shoot" },
} satisfies CreateHostActuatorOptions;

/** Parameter tiles the `shoot` actuator accepts. */
export const parameters: ParameterTileInput[] = [
  { id: TileIds.Parameter.AnonymousActorRef, dataType: EcosimTypeIds.ActorRef, hidden: true },
  {
    id: TileIds.Parameter.Rate,
    dataType: CoreTypeIds.Number,
    label: "per/sec",
  },
];
