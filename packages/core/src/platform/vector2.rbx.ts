import type { Vector2Constructor, Vector2 as Vector2Interface } from "./vector2";

declare const Vector2: Vector2Constructor;

let wrapUnit = true;

class Vector2Impl implements Vector2Interface {
  readonly X: number;
  readonly Y: number;
  readonly Unit: Vector2Interface;
  readonly Magnitude: number;

  private readonly _native: Vector2Interface;

  constructor(x = 0, y = 0) {
    this._native = new Vector2(x, y);
    this.X = this._native.X;
    this.Y = this._native.Y;
    this.Magnitude = this._native.Magnitude;
    if (wrapUnit) {
      wrapUnit = false;
      this.Unit = Vector2Impl._wrap(this._native.Unit);
      wrapUnit = true;
    } else {
      this.Unit = this;
    }
  }

  private static _wrap(v: Vector2Interface): Vector2Impl {
    return new Vector2Impl(v.X, v.Y);
  }

  Abs(): Vector2Interface {
    return Vector2Impl._wrap(this._native.Abs());
  }
  Ceil(): Vector2Interface {
    return Vector2Impl._wrap(this._native.Ceil());
  }
  Floor(): Vector2Interface {
    return Vector2Impl._wrap(this._native.Floor());
  }
  Sign(): Vector2Interface {
    return Vector2Impl._wrap(this._native.Sign());
  }
  Angle(other: Vector2Interface, isSigned?: boolean): number {
    return this._native.Angle(other, isSigned);
  }
  Dot(other: Vector2Interface): number {
    return this._native.Dot(other);
  }
  Lerp(goal: Vector2Interface, alpha: number): Vector2Interface {
    return Vector2Impl._wrap(this._native.Lerp(goal, alpha));
  }
  Cross(other: Vector2Interface): number {
    return this._native.Cross(other);
  }
  Min(...vectors: Array<Vector2Interface>): Vector2Interface {
    return Vector2Impl._wrap(this._native.Min(...vectors));
  }
  Max(...vectors: Array<Vector2Interface>): Vector2Interface {
    return Vector2Impl._wrap(this._native.Max(...vectors));
  }

  add(v2: Vector2Interface): Vector2Interface {
    return new Vector2Impl(this.X + v2.X, this.Y + v2.Y);
  }
  sub(v2: Vector2Interface): Vector2Interface {
    return new Vector2Impl(this.X - v2.X, this.Y - v2.Y);
  }
  mul(other: Vector2Interface | number): Vector2Interface {
    if (typeIs(other, "number")) {
      return new Vector2Impl(this.X * other, this.Y * other);
    }
    return new Vector2Impl(this.X * other.X, this.Y * other.Y);
  }
  div(other: Vector2Interface | number): Vector2Interface {
    if (typeIs(other, "number")) {
      return new Vector2Impl(this.X / other, this.Y / other);
    }
    return new Vector2Impl(this.X / other.X, this.Y / other.Y);
  }
  idiv(other: Vector2Interface | number): Vector2Interface {
    if (typeIs(other, "number")) {
      return new Vector2Impl(math.floor(this.X / other), math.floor(this.Y / other));
    }
    return new Vector2Impl(math.floor(this.X / other.X), math.floor(this.Y / other.Y));
  }
  rotate(angle: number): Vector2Interface {
    const c = math.cos(angle);
    const s = math.sin(angle);
    return new Vector2Impl(this.X * c - this.Y * s, this.X * s + this.Y * c);
  }
}

const staticProps: Record<string, Vector2Impl> = {
  zero: new Vector2Impl(0, 0),
  one: new Vector2Impl(1, 1),
  xAxis: new Vector2Impl(1, 0),
  yAxis: new Vector2Impl(0, 1),
};

setmetatable(Vector2Impl as unknown as object, {
  __index: (_self: object, index: unknown) => {
    return staticProps[index as string];
  },
});

export { Vector2Impl as Vector2 };
