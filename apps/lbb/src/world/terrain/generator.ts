import type { ChunkCoord, ChunkData } from "./types";
import { CHUNK_SIZE, FIELD_PAD, SAMPLES, SAMPLES_TOTAL, sampleIndex } from "./types";

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

export function generateChunkField(coord: ChunkCoord): Float32Array {
  const field = new Float32Array(SAMPLES_TOTAL);

  const wx0 = coord.cx * CHUNK_SIZE;
  const wy0 = coord.cy * CHUNK_SIZE;
  const wz0 = coord.cz * CHUNK_SIZE;

  for (let lz = 0; lz < SAMPLES; lz++) {
    for (let ly = 0; ly < SAMPLES; ly++) {
      for (let lx = 0; lx < SAMPLES; lx++) {
        const wx = wx0 + lx - FIELD_PAD;
        const wy = wy0 + ly - FIELD_PAD;
        const wz = wz0 + lz - FIELD_PAD;

        const noiseScale = 0.02;
        const n = fbmNoise2d(wx * noiseScale, wz * noiseScale, 4);
        const height = 16 + n * 12;

        // Positive = solid, negative = air
        const density = height - wy;

        field[sampleIndex(lx, ly, lz)] = density;
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
