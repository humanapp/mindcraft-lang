import {
  bag,
  CoreTypeIds,
  choice,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  isNumberValue,
  type MapValue,
  mkCallDef,
  mod,
  type NumberValue,
  optional,
  param,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { getSelf } from "@/brain/execution-context-types";
import { TileIds } from "@/brain/tileids";
import type { ActionDef } from "../action-def";
import { resolveTargetActor } from "../utils";

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

type ShootState = {
  nextShootTime: number;
};

export function execShoot(ctx: ExecutionContext, args: MapValue): Value {
  const self = getSelf(ctx);
  if (!self) return VOID_VALUE;

  const now = self.engine.simTime;
  let state = getCallSiteState<ShootState>(ctx);
  if (!state) {
    state = { nextShootTime: 0 } satisfies ShootState;
    setCallSiteState(ctx, state);
  }

  if (now < state.nextShootTime) return FALSE_VALUE;

  let cooldown = 1000 / DEFAULT_SHOOT_RATE; // Default cooldown in ms
  const rateValue = args.v.get(kRateSlotId) as NumberValue | undefined;
  if (rateValue && isNumberValue(rateValue)) {
    const rate = Math.max(MIN_SHOOT_RATE, Math.min(MAX_SHOOT_RATE, rateValue.v));
    cooldown = 1000 / rate;
  }

  const target = resolveTargetActor(ctx, args, kAnonActorRefSlotId);
  if (!target) return FALSE_VALUE;

  // Drain energy from the shooter to pay for the shot. If they can't afford it, abort.
  if (self.energy < SHOOT_ENERGY_COST) return FALSE_VALUE;
  self.drainEnergy(SHOOT_ENERGY_COST);

  // Compute direction toward the target
  const dx = target.sprite.x - self.sprite.x;
  const dy = target.sprite.y - self.sprite.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return FALSE_VALUE;

  const dirX = dx / dist;
  const dirY = dy / dist;

  // Delegate the actual blip creation to the engine (may fail at cap)
  const blip = self.engine.spawnBlip(self.actorId, self.sprite.x, self.sprite.y, dirX, dirY);
  if (!blip) return FALSE_VALUE;

  state.nextShootTime = now + cooldown;

  return TRUE_VALUE;
}

export default {
  tileId: TileIds.Actuator.Shoot,
  callDef,
  fn: { exec: execShoot },
  isAsync: false,
  returnType: CoreTypeIds.Boolean,
  visual: { label: "shoot", iconUrl: "/assets/brain/icons/shoot.svg" },
} satisfies ActionDef;
