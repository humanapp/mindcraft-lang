import type { ChunkCoord, ChunkData } from "@/world/voxel/types";
import { chunkWorldOrigin, FIELD_PAD, SAMPLES, SAMPLES_TOTAL, sampleIndex } from "@/world/voxel/types";

// Simple deterministic noise using sine-based hash
function hash2d(x: number, z: number): number {
  let n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  n = n - Math.floor(n);
  return n;
}

function smoothNoise2d(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2d(ix, iz);
  const b = hash2d(ix + 1, iz);
  const c = hash2d(ix, iz + 1);
  const d = hash2d(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbmNoise2d(x: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise2d(x * frequency, z * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxAmp;
}

const NOISE_SCALE = 0.02;
const NOISE_OCTAVES = 4;
const BASE_HEIGHT = 32;
const HEIGHT_AMPLITUDE = 12;

export function baselineDensity(wx: number, wy: number, wz: number): number {
  const n = fbmNoise2d(wx * NOISE_SCALE, wz * NOISE_SCALE, NOISE_OCTAVES);
  return BASE_HEIGHT + n * HEIGHT_AMPLITUDE - wy;
}

export function generateChunkField(coord: ChunkCoord): Float32Array {
  const field = new Float32Array(SAMPLES_TOTAL);

  const [wx0, wy0, wz0] = chunkWorldOrigin(coord);

  for (let sz = 0; sz < SAMPLES; sz++) {
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const wx = wx0 + sx - FIELD_PAD;
        const wy = wy0 + sy - FIELD_PAD;
        const wz = wz0 + sz - FIELD_PAD;

        const density = baselineDensity(wx, wy, wz);

        field[sampleIndex(sx, sy, sz)] = density;
      }
    }
  }

  return field;
}

export function createChunkData(coord: ChunkCoord): ChunkData {
  return {
    coord,
    field: generateChunkField(coord),
    version: 0,
  };
}
