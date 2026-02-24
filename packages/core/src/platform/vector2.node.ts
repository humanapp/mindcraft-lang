import type { Vector2 } from "./vector2";

class Vector2Impl implements Vector2 {
  readonly X: number;
  readonly Y: number;

  constructor(x = 0, y = 0) {
    this.X = x;
    this.Y = y;
  }

  get Unit(): Vector2 {
    const mag = this.Magnitude;
    if (mag === 0) return new Vector2Impl(0, 0);
    return new Vector2Impl(this.X / mag, this.Y / mag);
  }

  get Magnitude(): number {
    return Math.sqrt(this.X * this.X + this.Y * this.Y);
  }

  Abs(): Vector2 {
    return new Vector2Impl(Math.abs(this.X), Math.abs(this.Y));
  }
  Ceil(): Vector2 {
    return new Vector2Impl(Math.ceil(this.X), Math.ceil(this.Y));
  }
  Floor(): Vector2 {
    return new Vector2Impl(Math.floor(this.X), Math.floor(this.Y));
  }
  Sign(): Vector2 {
    return new Vector2Impl(Math.sign(this.X), Math.sign(this.Y));
  }
  Angle(other: Vector2, isSigned?: boolean): number {
    const dot = this.Dot(other);
    const mags = this.Magnitude * other.Magnitude;
    if (mags === 0) return 0;
    let angle = Math.acos(Math.min(Math.max(dot / mags, -1), 1));
    if (isSigned) {
      angle *= Math.sign(this.X * other.Y - this.Y * other.X);
    }
    return angle;
  }
  Dot(other: Vector2): number {
    return this.X * other.X + this.Y * other.Y;
  }
  Lerp(goal: Vector2, alpha: number): Vector2 {
    return new Vector2Impl(this.X + (goal.X - this.X) * alpha, this.Y + (goal.Y - this.Y) * alpha);
  }
  Cross(other: Vector2): number {
    return this.X * other.Y - this.Y * other.X;
  }
  Min(...vectors: Array<Vector2>): Vector2 {
    let minX = this.X;
    let minY = this.Y;
    for (const vec of vectors) {
      if (vec.X < minX) minX = vec.X;
      if (vec.Y < minY) minY = vec.Y;
    }
    return new Vector2Impl(minX, minY);
  }
  Max(...vectors: Array<Vector2>): Vector2 {
    let maxX = this.X;
    let maxY = this.Y;
    for (const vec of vectors) {
      if (vec.X > maxX) maxX = vec.X;
      if (vec.Y > maxY) maxY = vec.Y;
    }
    return new Vector2Impl(maxX, maxY);
  }
  add(v2: Vector2): Vector2 {
    return new Vector2Impl(this.X + v2.X, this.Y + v2.Y);
  }
  sub(v2: Vector2): Vector2 {
    return new Vector2Impl(this.X - v2.X, this.Y - v2.Y);
  }
  mul(other: Vector2 | number): Vector2 {
    if (typeof other === "number") {
      return new Vector2Impl(this.X * other, this.Y * other);
    } else {
      return new Vector2Impl(this.X * other.X, this.Y * other.Y);
    }
  }
  div(other: Vector2 | number): Vector2 {
    if (typeof other === "number") {
      return new Vector2Impl(this.X / other, this.Y / other);
    } else {
      return new Vector2Impl(this.X / other.X, this.Y / other.Y);
    }
  }
  idiv(other: Vector2 | number): Vector2 {
    if (typeof other === "number") {
      return new Vector2Impl(Math.floor(this.X / other), Math.floor(this.Y / other));
    } else {
      return new Vector2Impl(Math.floor(this.X / other.X), Math.floor(this.Y / other.Y));
    }
  }
}

export { Vector2Impl as Vector2 };
