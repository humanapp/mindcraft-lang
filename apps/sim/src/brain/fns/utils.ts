import { Vector2 } from "@mindcraft-lang/core";
import type { ExecutionContext, MapValue, NumberValue, StructValue } from "@mindcraft-lang/core/brain";
import type { Actor } from "@/brain/actor";
import { getActor } from "@/brain/execution-context-types";
import { extractVector2, resolveActor } from "@/brain/type-system";

/**
 * Resolve a target position from (in order of precedence):
 *  1. Explicit anonymous actor-ref argument (looked up via `actorRefSlotId`)
 *  2. Rule `targetPos` variable
 *  3. Rule `targetActor` variable
 *
 * Useful for any actuator that needs to determine a target location from
 * call arguments or the current rule context.
 */
export function resolveTargetPosition(
  ctx: ExecutionContext,
  args: MapValue,
  actorRefSlotId?: number
): Vector2 | undefined {
  // 1. Explicit anonymous actor-ref argument
  if (actorRefSlotId !== undefined) {
    const targetActorValue = args.v.get(actorRefSlotId) as StructValue | undefined;
    if (targetActorValue) {
      const targetActor = resolveActor(targetActorValue, ctx);
      if (targetActor) {
        return new Vector2(targetActor.sprite.x, targetActor.sprite.y);
      }
    }
  }

  // 2. Rule's targetPos variable
  const targetPosVar = ctx.rule?.getVariable<StructValue>("targetPos");
  if (targetPosVar) {
    const pos = extractVector2(targetPosVar);
    if (pos) return pos;
  }

  // 3. Rule's targetActor variable
  const targetActorVar = ctx.rule?.getVariable<NumberValue>("targetActor");
  const targetId = targetActorVar?.v;
  const target = targetId ? getActor(ctx, targetId) : undefined;
  return target ? new Vector2(target.sprite.x, target.sprite.y) : undefined;
}

/**
 * Resolve the target Actor from (in order of precedence):
 *  1. Explicit anonymous actor-ref argument (looked up via `actorRefSlotId`)
 *  2. Rule `targetActor` variable
 *
 * Useful for any actuator that needs to determine a target actor from
 * call arguments or the current rule context.
 */
export function resolveTargetActor(ctx: ExecutionContext, args: MapValue, actorRefSlotId?: number): Actor | undefined {
  // 1. Explicit anonymous actor-ref argument
  if (actorRefSlotId !== undefined) {
    const targetActorValue = args.v.get(actorRefSlotId) as StructValue | undefined;
    if (targetActorValue) {
      return resolveActor(targetActorValue, ctx);
    }
  }

  // 2. Rule's targetActor variable
  const targetActorVar = ctx.rule?.getVariable<NumberValue>("targetActor");
  const targetId = targetActorVar?.v;
  return targetId ? getActor(ctx, targetId) : undefined;
}
