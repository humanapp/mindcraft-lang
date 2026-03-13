import { SAMPLES, SAMPLES_SQ, SAMPLES_TOTAL, sampleIndex } from "./types";

export function createField(): Float32Array {
  return new Float32Array(SAMPLES_TOTAL);
}

export function getSample(field: Float32Array, lx: number, ly: number, lz: number): number {
  return field[sampleIndex(lx, ly, lz)];
}

export function setSample(field: Float32Array, lx: number, ly: number, lz: number, value: number): void {
  field[sampleIndex(lx, ly, lz)] = value;
}

export function computeGradient(field: Float32Array, lx: number, ly: number, lz: number): [number, number, number] {
  const x0 = lx > 0 ? field[sampleIndex(lx - 1, ly, lz)] : field[sampleIndex(lx, ly, lz)];
  const x1 = lx < SAMPLES - 1 ? field[sampleIndex(lx + 1, ly, lz)] : field[sampleIndex(lx, ly, lz)];
  const y0 = ly > 0 ? field[sampleIndex(lx, ly - 1, lz)] : field[sampleIndex(lx, ly, lz)];
  const y1 = ly < SAMPLES - 1 ? field[sampleIndex(lx, ly + 1, lz)] : field[sampleIndex(lx, ly, lz)];
  const z0 = lz > 0 ? field[sampleIndex(lx, ly, lz - 1)] : field[sampleIndex(lx, ly, lz)];
  const z1 = lz < SAMPLES - 1 ? field[sampleIndex(lx, ly, lz + 1)] : field[sampleIndex(lx, ly, lz)];

  return [x0 - x1, y0 - y1, z0 - z1];
}
