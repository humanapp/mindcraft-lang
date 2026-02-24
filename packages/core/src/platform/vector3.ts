/**
 * Vector3 interface and constructor declaration. Matches Roblox's Vector3 API.
 */

/** Platform-agnostic NormalId enum matching Roblox's Enum.NormalId */
export enum NormalId {
  Top = 1,
  Bottom = 4,
  Front = 5,
  Back = 2,
  Right = 0,
  Left = 3,
}

/** Platform-agnostic Axis enum matching Roblox's Enum.Axis */
export enum Axis {
  X = 0,
  Y = 1,
  Z = 2,
}

export declare interface Vector3 {
  readonly X: number;
  readonly Y: number;
  readonly Z: number;
  readonly Unit: Vector3;
  readonly Magnitude: number;
  Abs(this: Vector3): Vector3;
  Ceil(this: Vector3): Vector3;
  Floor(this: Vector3): Vector3;
  Sign(this: Vector3): Vector3;
  Lerp(this: Vector3, goal: Vector3, alpha: number): Vector3;
  Dot(this: Vector3, other: Vector3): number;
  Cross(this: Vector3, other: Vector3): Vector3;
  FuzzyEq(this: Vector3, other: Vector3, epsilon?: number): boolean;
  Min(this: Vector3, ...vectors: Array<Vector3>): Vector3;
  Max(this: Vector3, ...vectors: Array<Vector3>): Vector3;
  Angle(this: Vector3, other: Vector3, axis?: Vector3): number;

  add(this: Vector3, v3: Vector3): Vector3;
  sub(this: Vector3, v3: Vector3): Vector3;
  mul(this: Vector3, other: Vector3 | number): Vector3;
  div(this: Vector3, other: Vector3 | number): Vector3;
  idiv(this: Vector3, other: Vector3 | number): Vector3;
}

export declare interface Vector3Constructor {
  readonly zero: Vector3;
  readonly one: Vector3;
  readonly xAxis: Vector3;
  readonly yAxis: Vector3;
  readonly zAxis: Vector3;
  /** Constructs a new Vector3 in a particular direction. */
  FromNormalId: (norm: NormalId) => Vector3;
  /** Constructs a new Vector3 for a particular axis. */
  FromAxis: (axis: Axis) => Vector3;
  new (x?: number, y?: number, z?: number): Vector3;
}

export declare const Vector3: Vector3Constructor;
