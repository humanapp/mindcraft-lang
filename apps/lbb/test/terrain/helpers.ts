import { strict as assert } from "node:assert";
import { syncChunkPadding } from "../../src/world/terrain/halo";
import type { ChunkCoord, ChunkData, MeshData } from "../../src/world/terrain/types";
import {
  chunkId,
  chunkWorldOrigin,
  FIELD_PAD,
  SAMPLES,
  SAMPLES_TOTAL,
  sampleIndex,
} from "../../src/world/terrain/types";

export type FieldFiller = (wx: number, wy: number, wz: number) => number;

export function fillChunkField(coord: ChunkCoord, filler: FieldFiller): Float32Array {
  const field = new Float32Array(SAMPLES_TOTAL);
  const [wx0, wy0, wz0] = chunkWorldOrigin(coord);

  for (let sz = 0; sz < SAMPLES; sz++) {
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const wx = wx0 + sx - FIELD_PAD;
        const wy = wy0 + sy - FIELD_PAD;
        const wz = wz0 + sz - FIELD_PAD;
        field[sampleIndex(sx, sy, sz)] = filler(wx, wy, wz);
      }
    }
  }
  return field;
}

export function makeChunk(coord: ChunkCoord, filler: FieldFiller): ChunkData {
  return { coord, field: fillChunkField(coord, filler), version: 0 };
}

export function makeChunkGrid(coords: ChunkCoord[], filler: FieldFiller): Map<string, ChunkData> {
  const map = new Map<string, ChunkData>();
  for (const coord of coords) {
    map.set(chunkId(coord), makeChunk(coord, filler));
  }
  for (const chunk of map.values()) {
    syncChunkPadding(chunk, map);
  }
  return map;
}

export function assertApproxEqual(actual: number, expected: number, epsilon: number, msg?: string): void {
  const diff = Math.abs(actual - expected);
  if (diff > epsilon) {
    const label = msg ? `${msg}: ` : "";
    assert.fail(`${label}expected ${expected} +/- ${epsilon}, got ${actual} (diff=${diff})`);
  }
}

export function vec3Length(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function meshVerticesInRange(
  mesh: MeshData,
  axis: "x" | "y" | "z",
  lo: number,
  hi: number
): { index: number; pos: [number, number, number] }[] {
  const results: { index: number; pos: [number, number, number] }[] = [];
  for (let i = 0; i < mesh.vertexCount; i++) {
    const px = mesh.positions[i * 3];
    const py = mesh.positions[i * 3 + 1];
    const pz = mesh.positions[i * 3 + 2];
    const val = axis === "x" ? px : axis === "y" ? py : pz;
    if (val >= lo && val <= hi) {
      results.push({ index: i, pos: [px, py, pz] });
    }
  }
  return results;
}

export function findClosestVertex(
  target: [number, number, number],
  mesh: MeshData
): { index: number; distance: number } {
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const dx = mesh.positions[i * 3] - target[0];
    const dy = mesh.positions[i * 3 + 1] - target[1];
    const dz = mesh.positions[i * 3 + 2] - target[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distance: bestDist };
}
