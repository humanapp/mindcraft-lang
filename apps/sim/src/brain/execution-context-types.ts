/**
 * Application-specific execution context types.
 *
 * This file defines type guards and utilities for safely accessing
 * application-specific data injected into the ExecutionContext.
 */

import { type ExecutionContext, isNumberValue } from "@mindcraft-lang/core/brain";
import type { Actor } from "./actor";

/**
 * Extended ExecutionContext interface with Actor data. This is a type-safe view
 * of the execution context for this application.
 */
export interface ActorExecutionContext extends ExecutionContext {
  data: Actor;
}

/**
 * Type guard to check if the execution context has Actor data.
 *
 * @param ctx - The execution context to check
 * @returns True if ctx.data is an Actor instance
 */
export function hasActorData(ctx: ExecutionContext): ctx is ActorExecutionContext {
  return ctx.data !== undefined && ctx.data !== null && typeof ctx.data === "object" && "actorId" in ctx.data;
}

/**
 * Safely extract the Actor from the execution context. Returns undefined if no
 * Actor is present.
 *
 * @param ctx - The execution context
 * @returns The Actor instance or undefined
 */
export function getSelf(ctx: ExecutionContext): Actor | undefined {
  if (hasActorData(ctx)) {
    return ctx.data;
  }
  return undefined;
}

/**
 * Utility to get an Actor by ID via the execution context.
 *
 * @param ctx - The execution context
 * @param actorId - The ID of the Actor to retrieve
 * @returns The Actor instance or undefined if not found
 */
export function getActor(ctx: ExecutionContext, actorId: number): Actor | undefined {
  if (!hasActorData(ctx)) {
    return undefined;
  }
  const self = ctx.data;
  const engine = self.engine;
  return engine.getActorById(actorId);
}

/**
 * Utility to get the "targetActor" Actor set by a sensor in the execution
 * context, if one was set.
 *
 * @param ctx - The execution context
 * @returns The target Actor instance or undefined if not set or not found
 */
export function getTargetActor(ctx: ExecutionContext): Actor | undefined {
  if (!hasActorData(ctx)) {
    return undefined;
  }
  const rule = ctx.rule;
  if (!rule) {
    return undefined;
  }
  const targetActorId = rule.getVariable("targetActor");

  if (!targetActorId || !isNumberValue(targetActorId)) {
    return undefined;
  }
  return getActor(ctx, targetActorId.v);
}
