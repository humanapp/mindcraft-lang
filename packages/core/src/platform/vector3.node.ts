import type { Vector3 } from "./vector3";

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

class Vector3Impl implements Vector3 {
  readonly X: number;
  readonly Y: number;
  readonly Z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.X = x;
    this.Y = y;
    this.Z = z;
  }

  get Unit(): Vector3 {
    const mag = this.Magnitude;
    if (mag === 0) return new Vector3Impl(0, 0, 0);
    return new Vector3Impl(this.X / mag, this.Y / mag, this.Z / mag);
  }

  get Magnitude(): number {
    return Math.sqrt(this.X * this.X + this.Y * this.Y + this.Z * this.Z);
  }

  Abs(): Vector3 {
    return new Vector3Impl(Math.abs(this.X), Math.abs(this.Y), Math.abs(this.Z));
  }

  Ceil(): Vector3 {
    return new Vector3Impl(Math.ceil(this.X), Math.ceil(this.Y), Math.ceil(this.Z));
  }

  Floor(): Vector3 {
    return new Vector3Impl(Math.floor(this.X), Math.floor(this.Y), Math.floor(this.Z));
  }

  Sign(): Vector3 {
    return new Vector3Impl(Math.sign(this.X), Math.sign(this.Y), Math.sign(this.Z));
  }

  Lerp(goal: Vector3, alpha: number): Vector3 {
    return new Vector3Impl(
      this.X + (goal.X - this.X) * alpha,
      this.Y + (goal.Y - this.Y) * alpha,
      this.Z + (goal.Z - this.Z) * alpha
    );
  }

  Dot(other: Vector3): number {
    return this.X * other.X + this.Y * other.Y + this.Z * other.Z;
  }

  Cross(other: Vector3): Vector3 {
    return new Vector3Impl(
      this.Y * other.Z - this.Z * other.Y,
      this.Z * other.X - this.X * other.Z,
      this.X * other.Y - this.Y * other.X
    );
  }

  FuzzyEq(other: Vector3, epsilon = 1e-5): boolean {
    return (
      Math.abs(this.X - other.X) <= epsilon &&
      Math.abs(this.Y - other.Y) <= epsilon &&
      Math.abs(this.Z - other.Z) <= epsilon
    );
  }

  Min(...vectors: Array<Vector3>): Vector3 {
    let minX = this.X;
    let minY = this.Y;
    let minZ = this.Z;

    for (const v of vectors) {
      if (v.X < minX) minX = v.X;
      if (v.Y < minY) minY = v.Y;
      if (v.Z < minZ) minZ = v.Z;
    }

    return new Vector3Impl(minX, minY, minZ);
  }

  Max(...vectors: Array<Vector3>): Vector3 {
    let maxX = this.X;
    let maxY = this.Y;
    let maxZ = this.Z;

    for (const v of vectors) {
      if (v.X > maxX) maxX = v.X;
      if (v.Y > maxY) maxY = v.Y;
      if (v.Z > maxZ) maxZ = v.Z;
    }

    return new Vector3Impl(maxX, maxY, maxZ);
  }

  Angle(other: Vector3, axis?: Vector3): number {
    const dot = this.Dot(other);
    const mag1 = this.Magnitude;
    const mag2 = other.Magnitude;

    if (mag1 === 0 || mag2 === 0) return 0;

    const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    const angle = Math.acos(cosAngle);

    if (axis) {
      const cross = this.Cross(other);
      const sign = axis.Dot(cross);
      return sign < 0 ? -angle : angle;
    }

    return angle;
  }

  add(this: Vector3, v3: Vector3): Vector3 {
    return new Vector3Impl(this.X + v3.X, this.Y + v3.Y, this.Z + v3.Z);
  }
  sub(this: Vector3, v3: Vector3): Vector3 {
    return new Vector3Impl(this.X - v3.X, this.Y - v3.Y, this.Z - v3.Z);
  }
  mul(this: Vector3, other: Vector3 | number): Vector3 {
    if (typeof other === "number") {
      return new Vector3Impl(this.X * other, this.Y * other, this.Z * other);
    } else {
      return new Vector3Impl(this.X * other.X, this.Y * other.Y, this.Z * other.Z);
    }
  }
  div(this: Vector3, other: Vector3 | number): Vector3 {
    if (typeof other === "number") {
      return new Vector3Impl(this.X / other, this.Y / other, this.Z / other);
    } else {
      return new Vector3Impl(this.X / other.X, this.Y / other.Y, this.Z / other.Z);
    }
  }
  idiv(this: Vector3, other: Vector3 | number): Vector3 {
    if (typeof other === "number") {
      return new Vector3Impl(Math.floor(this.X / other), Math.floor(this.Y / other), Math.floor(this.Z / other));
    } else {
      return new Vector3Impl(Math.floor(this.X / other.X), Math.floor(this.Y / other.Y), Math.floor(this.Z / other.Z));
    }
  }

  static get zero(): Vector3 {
    return new Vector3Impl(0, 0, 0);
  }

  static get one(): Vector3 {
    return new Vector3Impl(1, 1, 1);
  }

  static get xAxis(): Vector3 {
    return new Vector3Impl(1, 0, 0);
  }

  static get yAxis(): Vector3 {
    return new Vector3Impl(0, 1, 0);
  }

  static get zAxis(): Vector3 {
    return new Vector3Impl(0, 0, 1);
  }

  static FromNormalId(norm: NormalId): Vector3 {
    switch (norm) {
      case NormalId.Top:
        return new Vector3Impl(0, 1, 0);
      case NormalId.Bottom:
        return new Vector3Impl(0, -1, 0);
      case NormalId.Front:
        return new Vector3Impl(0, 0, -1);
      case NormalId.Back:
        return new Vector3Impl(0, 0, 1);
      case NormalId.Right:
        return new Vector3Impl(1, 0, 0);
      case NormalId.Left:
        return new Vector3Impl(-1, 0, 0);
      default:
        return new Vector3Impl(0, 0, 0);
    }
  }

  static FromAxis(axis: Axis): Vector3 {
    switch (axis) {
      case Axis.X:
        return new Vector3Impl(1, 0, 0);
      case Axis.Y:
        return new Vector3Impl(0, 1, 0);
      case Axis.Z:
        return new Vector3Impl(0, 0, 1);
      default:
        return new Vector3Impl(0, 0, 0);
    }
  }
}

export { Vector3Impl as Vector3 };
