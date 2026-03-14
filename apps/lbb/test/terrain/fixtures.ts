import type { FieldFiller } from "./helpers";

export function flatPlane(height: number): FieldFiller {
  return (_wx, wy, _wz) => height - wy;
}

export function sphere(center: [number, number, number], radius: number): FieldFiller {
  const [sx, sy, sz] = center;
  return (wx, wy, wz) => {
    const dx = wx - sx;
    const dy = wy - sy;
    const dz = wz - sz;
    return radius - Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
}

export function slopedHill(baseHeight: number, slopeX: number, slopeZ: number): FieldFiller {
  return (wx, wy, wz) => baseHeight + wx * slopeX + wz * slopeZ - wy;
}

export function tunnel(
  center: [number, number, number],
  axis: "x" | "y" | "z",
  radius: number,
  groundHeight: number
): FieldFiller {
  const [cx, cy, cz] = center;
  return (wx, wy, wz) => {
    const ground = groundHeight - wy;
    let tunnelDist: number;
    if (axis === "x") {
      const dy = wy - cy;
      const dz = wz - cz;
      tunnelDist = Math.sqrt(dy * dy + dz * dz);
    } else if (axis === "y") {
      const dx = wx - cx;
      const dz = wz - cz;
      tunnelDist = Math.sqrt(dx * dx + dz * dz);
    } else {
      const dx = wx - cx;
      const dy = wy - cy;
      tunnelDist = Math.sqrt(dx * dx + dy * dy);
    }
    const tunnelHole = tunnelDist - radius;
    return Math.min(ground, tunnelHole);
  };
}
