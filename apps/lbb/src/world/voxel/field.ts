import { SAMPLES, SAMPLES_SQ, SAMPLES_TOTAL, sampleIndex } from "./types";

export function createField(): Float32Array {
  return new Float32Array(SAMPLES_TOTAL);
}

export function getSample(field: Float32Array, sx: number, sy: number, sz: number): number {
  return field[sampleIndex(sx, sy, sz)];
}

export function setSample(field: Float32Array, sx: number, sy: number, sz: number, value: number): void {
  field[sampleIndex(sx, sy, sz)] = value;
}

export function computeGradient(field: Float32Array, sx: number, sy: number, sz: number): [number, number, number] {
  const x0 = sx > 0 ? field[sampleIndex(sx - 1, sy, sz)] : field[sampleIndex(sx, sy, sz)];
  const x1 = sx < SAMPLES - 1 ? field[sampleIndex(sx + 1, sy, sz)] : field[sampleIndex(sx, sy, sz)];
  const y0 = sy > 0 ? field[sampleIndex(sx, sy - 1, sz)] : field[sampleIndex(sx, sy, sz)];
  const y1 = sy < SAMPLES - 1 ? field[sampleIndex(sx, sy + 1, sz)] : field[sampleIndex(sx, sy, sz)];
  const z0 = sz > 0 ? field[sampleIndex(sx, sy, sz - 1)] : field[sampleIndex(sx, sy, sz)];
  const z1 = sz < SAMPLES - 1 ? field[sampleIndex(sx, sy, sz + 1)] : field[sampleIndex(sx, sy, sz)];

  return [x0 - x1, y0 - y1, z0 - z1];
}
