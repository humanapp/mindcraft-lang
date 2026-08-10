import {
  bag,
  CoreTypeIds,
  type CreateHostActuatorOptions,
  choice,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  isNumberValue,
  logger,
  mkCallDef,
  mod,
  type NumberValue,
  optional,
  type ParameterTileInput,
  param,
  type ReadonlyList,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { EcosimHostActions } from "@/brain/abi-ids";
import { getSelf } from "@/brain/execution-context-types";
import { ICON_BASE } from "@/brain/icon-base";
import { TileIds } from "@/brain/tileids";
import { EcosimTypeIds } from "@/brain/type-system";
import { resolveTargetActor } from "./utils";

const AnonActorRef = param(TileIds.Parameter.AnonymousActorRef, {
  anonymous: true,
});
const Rate = param(TileIds.Parameter.Rate);

const callDef = mkCallDef(bag(optional(AnonActorRef), optional(Rate)));

const kAnonActorRefSlotId = getSlotId(callDef, AnonActorRef);
const kRateSlotId = getSlotId(callDef, Rate);

/** Shots per second a call-site fires at when its call names no rate. */
const DEFAULT_SHOOT_RATE = 2;

/** Highest shots per second a call-site fires at. */
const MAX_SHOOT_RATE = 5;

/** Lowest shots per second a call-site fires at. */
const MIN_SHOOT_RATE = 0;

/** The requested shots-per-second `rate`, brought into the range the shooter fires at. */
export function clampShootRate(rate: number): number {
  return Math.max(MIN_SHOOT_RATE, Math.min(MAX_SHOOT_RATE, rate));
}

/** Energy cost to fire a single blip. */
const SHOOT_ENERGY_COST = 5;

/**
 * Recoil impulse magnitude (mass * px/s) applied to the shooter opposite the blip.
 * Divided by body mass to get the resulting velocity change, so heavier actors
 * recoil less. Plants route this through PlantComp.applyImpulse() so the spring
 * integrator picks it up (PlantComp.tick() zeros Matter body velocity each frame).
 */
const SHOOT_KICKBACK_IMPULSE = 1.5;

type ShootState = {
  nextShootTime: number;
};

function initShoot(ctx: ExecutionContext): void {
  setCallSiteState(ctx, { nextShootTime: 0 } satisfies ShootState);
}

export function execShoot(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    const self = getSelf(ctx);
    if (!self) return VOID_VALUE;

    const now = self.engine.simTime;
    const state = getCallSiteState<ShootState>(ctx)!;

    if (now < state.nextShootTime) return FALSE_VALUE;

    let cooldown = 1000 / DEFAULT_SHOOT_RATE; // Default cooldown in ms
    const rateValue = args.get(kRateSlotId) as NumberValue | undefined;
    if (rateValue && isNumberValue(rateValue)) {
      cooldown = 1000 / clampShootRate(rateValue.v);
    }

    const target = resolveTargetActor(ctx, args, kAnonActorRefSlotId);

    // Drain energy from the shooter to pay for the shot. If they can't afford it, abort.
    if (self.energy < SHOOT_ENERGY_COST) return FALSE_VALUE;
    self.drainEnergy(SHOOT_ENERGY_COST);

    // Compute direction: toward the target if one exists, otherwise shoot forward.
    let dirX: number;
    let dirY: number;
    if (target) {
      const dx = target.sprite.x - self.sprite.x;
      const dy = target.sprite.y - self.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return FALSE_VALUE;
      dirX = dx / dist;
      dirY = dy / dist;
    } else {
      const angle = self.sprite.rotation;
      dirX = Math.cos(angle);
      dirY = Math.sin(angle);
    }

    // Delegate the actual blip creation to the engine (may fail at cap)
    const blip = self.engine.spawnBlip(self.actorId, self.sprite.x, self.sprite.y, dirX, dirY);
    if (!blip) return FALSE_VALUE;

    // Apply kickback: velocity impulse in the opposite direction of the blip.
    const body = self.sprite.body as MatterJS.BodyType | null;
    if (body) {
      const dv = SHOOT_KICKBACK_IMPULSE / body.mass;
      const kickX = -dirX * dv;
      const kickY = -dirY * dv;
      if (self.plantComp) {
        // Plant spring integrator zeroes Matter velocity every tick; inject
        // the kickback directly into the spring velocity instead.
        self.plantComp.applyImpulse(kickX * 10, kickY * 10);
      } else {
        self.sprite.setVelocity(body.velocity.x + kickX, body.velocity.y + kickY);
      }
    }

    state.nextShootTime = now + cooldown;

    return TRUE_VALUE;
  } catch (error) {
    logger.error("Error executing shoot action:", error);
    return FALSE_VALUE;
  }
}

export default {
  ...EcosimHostActions.Shoot,
  callDef,
  fn: { onInitialized: initShoot, exec: execShoot },
  isAsync: false,
  metadata: {
    label: "shoot",
    iconUrl: `${ICON_BASE}/shoot.svg`,
    grammarNote: `rate clamps to ${MIN_SHOOT_RATE}..${MAX_SHOOT_RATE} shots per second`,
  },
} satisfies CreateHostActuatorOptions;

export const parameters: ParameterTileInput[] = [
  { id: TileIds.Parameter.AnonymousActorRef, dataType: EcosimTypeIds.ActorRef, hidden: true },
  {
    id: TileIds.Parameter.Rate,
    dataType: CoreTypeIds.Number,
    label: "per/sec",
    iconUrl: `${ICON_BASE}/fps.svg`,
  },
];
