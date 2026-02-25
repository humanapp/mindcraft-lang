// Minimal, backend-agnostic math for character controller + rig layers.
// Plain value types (no Three.js / Roblox types), so this code ports cleanly.
//
// Conventions:
// - Right-handed coordinates.
// - Quaternion is (x, y, z, w) and assumed normalized for rotations.
// - Functions are allocation-friendly but do return new objects (immutable style).

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function q(x = 0, y = 0, z = 0, w = 1): Quat {
  return { x, y, z, w };
}

export const V3_ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const V3_UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
export const V3_FWD: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });

// -----------------------------------------------------------------------------
// Scalars
// -----------------------------------------------------------------------------

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function deg(radVal: number): number {
  return (radVal * 180) / Math.PI;
}

// -----------------------------------------------------------------------------
// Vec3 basics
// -----------------------------------------------------------------------------

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mul(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lenSq(a: Vec3): number {
  return dot(a, a);
}

export function len(a: Vec3): number {
  return Math.sqrt(lenSq(a));
}

export function distanceSq(a: Vec3, b: Vec3): number {
  return lenSq(sub(a, b));
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSq(a, b));
}

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  if (l <= 1e-12) return { x: 0, y: 0, z: 0 };
  return scale(a, 1 / l);
}

export function negate(a: Vec3): Vec3 {
  return { x: -a.x, y: -a.y, z: -a.z };
}

export function abs(a: Vec3): Vec3 {
  return { x: Math.abs(a.x), y: Math.abs(a.y), z: Math.abs(a.z) };
}

export function min(a: Vec3, b: Vec3): Vec3 {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
}

export function max(a: Vec3, b: Vec3): Vec3 {
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
}

// Projection helpers
export function projOnPlane(v: Vec3, planeNormal: Vec3): Vec3 {
  // v - n * dot(v,n)
  const n = normalize(planeNormal);
  return sub(v, scale(n, dot(v, n)));
}

export function projOnAxis(v: Vec3, axis: Vec3): Vec3 {
  const a = normalize(axis);
  return scale(a, dot(v, a));
}

export function withY(v: Vec3, y: number): Vec3 {
  return { x: v.x, y, z: v.z };
}

export function horiz(v: Vec3): Vec3 {
  return { x: v.x, y: 0, z: v.z };
}

// -----------------------------------------------------------------------------
// Quaternions
// -----------------------------------------------------------------------------

export function qNormalize(qq: Quat): Quat {
  const s = qq.x * qq.x + qq.y * qq.y + qq.z * qq.z + qq.w * qq.w;
  if (s <= 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  const inv = 1 / Math.sqrt(s);
  return { x: qq.x * inv, y: qq.y * inv, z: qq.z * inv, w: qq.w * inv };
}

export function qConjugate(qq: Quat): Quat {
  return { x: -qq.x, y: -qq.y, z: -qq.z, w: qq.w };
}

export function qInverse(qq: Quat): Quat {
  // For unit quaternions, inverse = conjugate.
  // For safety, handle non-unit:
  const s = qq.x * qq.x + qq.y * qq.y + qq.z * qq.z + qq.w * qq.w;
  if (s <= 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  const inv = 1 / s;
  return { x: -qq.x * inv, y: -qq.y * inv, z: -qq.z * inv, w: qq.w * inv };
}

export function qMul(a: Quat, b: Quat): Quat {
  // Hamilton product
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const a = normalize(axis);
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return qNormalize({ x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(half) });
}

export function qRotateVec3(qq: Quat, v: Vec3): Vec3 {
  // v' = q * (v,0) * q^-1
  const qn = qNormalize(qq);
  const vx = v.x,
    vy = v.y,
    vz = v.z;
  const qx = qn.x,
    qy = qn.y,
    qz = qn.z,
    qw = qn.w;

  // Optimized quaternion-vector rotation
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  // v' = v + qw * t + cross(q.xyz, t)
  return {
    x: vx + qw * tx + (qy * tz - qz * ty),
    y: vy + qw * ty + (qz * tx - qx * tz),
    z: vz + qw * tz + (qx * ty - qy * tx),
  };
}

export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  // Minimal slerp; good enough for targets and blending.
  const tt = clamp01(t);
  const ax = a.x,
    ay = a.y,
    az = a.z,
    aw = a.w;
  let bx = b.x,
    by = b.y,
    bz = b.z,
    bw = b.w;

  // Compute cosine of angle between quaternions
  let cos = ax * bx + ay * by + az * bz + aw * bw;

  // If negative, take shorter path
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  // If very close, lerp and normalize
  if (cos > 0.9995) {
    return qNormalize({
      x: lerp(ax, bx, tt),
      y: lerp(ay, by, tt),
      z: lerp(az, bz, tt),
      w: lerp(aw, bw, tt),
    });
  }

  const theta = Math.acos(clamp(cos, -1, 1));
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1 - tt) * theta) / sinTheta;
  const w2 = Math.sin(tt * theta) / sinTheta;

  return qNormalize({
    x: ax * w1 + bx * w2,
    y: ay * w1 + by * w2,
    z: az * w1 + bz * w2,
    w: aw * w1 + bw * w2,
  });
}

// -----------------------------------------------------------------------------
// Orientation helpers (for stabilizer / joint drives)
// -----------------------------------------------------------------------------

export function angleBetweenUnitVecs(aUnit: Vec3, bUnit: Vec3): number {
  // Assumes inputs are normalized.
  return Math.acos(clamp(dot(aUnit, bUnit), -1, 1));
}

export function safeNormalize(a: Vec3, fallback: Vec3 = V3_ZERO): Vec3 {
  const l = len(a);
  if (l <= 1e-12) return fallback;
  return scale(a, 1 / l);
}

export function signedAngleOnPlane(from: Vec3, to: Vec3, planeNormal: Vec3): number {
  // Signed angle from "from" to "to" around planeNormal.
  const n = normalize(planeNormal);
  const f = normalize(projOnPlane(from, n));
  const t = normalize(projOnPlane(to, n));
  const c = clamp(dot(f, t), -1, 1);
  const angle = Math.acos(c);
  const s = dot(n, cross(f, t));
  return s < 0 ? -angle : angle;
}

export function yawFromForward(forward: Vec3, worldUp: Vec3 = V3_UP): number {
  // Returns yaw angle around worldUp from world forward (0,0,1) to the given forward.
  const f = normalize(projOnPlane(forward, worldUp));
  return signedAngleOnPlane(V3_FWD, f, worldUp);
}

export function upFromQuat(rot: Quat): Vec3 {
  // Rotate local up (0,1,0) by rot.
  return qRotateVec3(rot, V3_UP);
}

export function forwardFromQuat(rot: Quat): Vec3 {
  // Rotate local forward (0,0,1) by rot.
  return qRotateVec3(rot, V3_FWD);
}

// -----------------------------------------------------------------------------
// 2D helpers (for capture point logic using x/z plane)
// -----------------------------------------------------------------------------

export type Vec2 = { x: number; y: number };

export function v2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function toXZ(v: Vec3): Vec2 {
  return { x: v.x, y: v.z };
}

export function fromXZ(v: Vec2, y = 0): Vec3 {
  return { x: v.x, y, z: v.y };
}

export function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale2(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function lenSq2(a: Vec2): number {
  return dot2(a, a);
}

export function len2(a: Vec2): number {
  return Math.sqrt(lenSq2(a));
}

export function normalize2(a: Vec2): Vec2 {
  const l = len2(a);
  if (l <= 1e-12) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function clampLen2(a: Vec2, minLen: number, maxLen: number): Vec2 {
  const l = len2(a);
  if (l <= 1e-12) return { x: 0, y: 0 };
  const cl = clamp(l, minLen, maxLen);
  const s = cl / l;
  return scale2(a, s);
}

// -----------------------------------------------------------------------------
// Small utility: exponential smoothing (frame-rate independent-ish)
// -----------------------------------------------------------------------------

export function expSmoothingAlpha(dt: number, timeConstant: number): number {
  // timeConstant in seconds; larger -> smoother.
  // alpha = 1 - exp(-dt / tau)
  if (timeConstant <= 1e-6) return 1;
  return 1 - Math.exp(-dt / timeConstant);
}

export function smoothVec3(prev: Vec3, next: Vec3, alpha: number): Vec3 {
  const t = clamp01(alpha);
  return {
    x: lerp(prev.x, next.x, t),
    y: lerp(prev.y, next.y, t),
    z: lerp(prev.z, next.z, t),
  };
}

export function smoothQuat(prev: Quat, next: Quat, alpha: number): Quat {
  return qSlerp(prev, next, clamp01(alpha));
}
