/**
 * This file is non-authoritative. It was copied from apps/sim/ambient.
 * Re-generate and re-copy here whenever you notice it is out of date.
 * This file is not shipped and not used in production. It exists solely to
 * provide types for the examples.
 */

declare module "mindcraft" {
  interface MindcraftTypeMap {
    Vector2: Vector2;
    ActorRef: ActorRef;
    "ActorRef?": ActorRef | null;
    "Vector2?": Vector2 | null;
  }

  export interface Vector2 {
    x: number;
    y: number;
    add(other: Vector2): Vector2;
    sub(other: Vector2): Vector2;
    mul(scalar: number): Vector2;
    div(scalar: number): Vector2;
    dot(other: Vector2): number;
    cross(other: Vector2): number;
    magnitude(): number;
    normalize(): Vector2;
    distance(other: Vector2): number;
    lerp(goal: Vector2, alpha: number): Vector2;
    angle(other: Vector2): number;
    rotate(angle: number): Vector2;
  }
  export interface ActorRef {
    readonly __brand: unique symbol;
    readonly id: number;
    position: Vector2;
    rotation: number;
    readonly "energy pct": number;
    readonly forward: Vector2;
  }
  export interface BrainContext {
    getTargetActor(): ActorRef | null;
    getTargetPosition(): Vector2 | null;
  }
  export interface EngineContext {
    getActorsByArchetype(archetype: string): Array<ActorRef>;
    getActorById(id: number): ActorRef;
  }
  export interface Context {
    readonly self: ActorRef;
  }
}
