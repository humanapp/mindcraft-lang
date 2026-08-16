import type { ExecutionContext, NumberValue, StructValue } from "@mindcraft-lang/core/app";
import { getRuleVariable, isNilValue, type ReadonlyList, type Value, Vector2 } from "@mindcraft-lang/core/app";
import type { Actor } from "../actor";
import { getActor } from "../execution-context-types";
import { EcosimTypeIds, extractVector2, resolveActor } from "../type-system";

/**
 * True when a positional action arg slot contains a non-nil value.
 *
 * @param args - The action's argument list.
 * @param slotId - Slot index resolved with `getSlotId`.
 */
export function hasArg(args: ReadonlyList<Value>, slotId: number): boolean {
  const value = args.at(slotId);
  return value !== undefined && !isNilValue(value);
}

/**
 * Resolve a target position from (in order of precedence):
 *  1. Explicit anonymous actor-ref argument (looked up via `actorRefSlotId`)
 *  2. Rule `targetPos` variable
 *  3. Rule `targetActor` variable
 *
 * Useful for any actuator that needs to determine a target location from
 * call arguments or the current rule context.
 *
 * @param ctx - The execution context.
 * @param args - The action's argument list.
 * @param actorRefSlotId - Slot holding an optional explicit actor ref.
 * @returns The target position in simulation pixels, or undefined.
 */
export function resolveTargetPosition(
  ctx: ExecutionContext,
  args: ReadonlyList<Value>,
  actorRefSlotId?: number
): Vector2 | undefined {
  // 1. Explicit anonymous actor-ref argument
  if (actorRefSlotId !== undefined) {
    const targetActorValue = args.at(actorRefSlotId);
    if (targetActorValue && !isNilValue(targetActorValue)) {
      const targetActor = resolveActor(targetActorValue as StructValue, ctx);
      if (targetActor) {
        return new Vector2(targetActor.sprite.x, targetActor.sprite.y);
      }
    }
  }

  // 2. Rule's targetPos variable
  const targetPosVar = getRuleVariable<StructValue>(ctx, "targetPos");
  if (targetPosVar && targetPosVar.typeId === EcosimTypeIds.Vector2) {
    const pos = extractVector2(targetPosVar);
    if (pos) return pos;
  }

  // 3. Rule's targetActor variable
  const targetActorVar = getRuleVariable<NumberValue>(ctx, "targetActor");
  const targetId = targetActorVar?.v;
  const target = targetId !== undefined ? getActor(ctx, targetId) : undefined;
  return target ? new Vector2(target.sprite.x, target.sprite.y) : undefined;
}

/**
 * Resolve the target Actor from (in order of precedence):
 *  1. Explicit anonymous actor-ref argument (looked up via `actorRefSlotId`)
 *  2. Rule `targetActor` variable
 *
 * Useful for any actuator that needs to determine a target actor from
 * call arguments or the current rule context.
 *
 * @param ctx - The execution context.
 * @param args - The action's argument list.
 * @param actorRefSlotId - Slot holding an optional explicit actor ref.
 * @returns The target actor, or undefined.
 */
export function resolveTargetActor(
  ctx: ExecutionContext,
  args: ReadonlyList<Value>,
  actorRefSlotId?: number
): Actor | undefined {
  // 1. Explicit anonymous actor-ref argument
  if (actorRefSlotId !== undefined) {
    const targetActorValue = args.at(actorRefSlotId);
    if (targetActorValue !== undefined && !isNilValue(targetActorValue)) {
      return resolveActor(targetActorValue as StructValue, ctx);
    }
  }

  // 2. Rule's targetActor variable
  const targetActorVar = getRuleVariable<NumberValue>(ctx, "targetActor");
  const targetId = targetActorVar?.v;
  return targetId !== undefined ? getActor(ctx, targetId) : undefined;
}
