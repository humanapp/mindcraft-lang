export declare interface Vector2 {
  readonly X: number;
  readonly Y: number;
  readonly Unit: Vector2;
  readonly Magnitude: number;
  Abs(this: Vector2): Vector2;
  Ceil(this: Vector2): Vector2;
  Floor(this: Vector2): Vector2;
  Sign(this: Vector2): Vector2;
  Angle(this: Vector2, other: Vector2, isSigned?: boolean): number;
  Dot(this: Vector2, other: Vector2): number;
  Lerp(this: Vector2, goal: Vector2, alpha: number): Vector2;
  Cross(this: Vector2, other: Vector2): number;
  Min(this: Vector2, ...vectors: Array<Vector2>): Vector2;
  Max(this: Vector2, ...vectors: Array<Vector2>): Vector2;
  add(this: Vector2, v2: Vector2): Vector2;
  sub(this: Vector2, v2: Vector2): Vector2;
  mul(this: Vector2, other: Vector2 | number): Vector2;
  div(this: Vector2, other: Vector2 | number): Vector2;
  idiv(this: Vector2, other: Vector2 | number): Vector2;
}

export declare interface Vector2Constructor {
  readonly zero: Vector2;
  readonly one: Vector2;
  readonly xAxis: Vector2;
  readonly yAxis: Vector2;
  new (x?: number, y?: number): Vector2;
}

export declare const Vector2: Vector2Constructor;
