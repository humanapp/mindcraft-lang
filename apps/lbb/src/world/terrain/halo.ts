import type { ChunkCoord, ChunkData } from "./types";
import { CHUNK_SIZE, chunkId, FIELD_PAD, SAMPLES, SAMPLES_SQ } from "./types";

export const NEIGHBOR_OFFSETS: readonly (readonly [number, number, number])[] = (() => {
  const offsets: [number, number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        offsets.push([dx, dy, dz]);
      }
    }
  }
  return offsets;
})();

export function syncChunkPadding(chunk: ChunkData, chunks: ReadonlyMap<string, ChunkData>): void {
  const { cx, cy, cz } = chunk.coord;
  const CORE_MIN = FIELD_PAD;
  const CORE_MAX = FIELD_PAD + CHUNK_SIZE + 1;

  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
    const neighbor = chunks.get(chunkId({ cx: cx + dx, cy: cy + dy, cz: cz + dz }));
    if (!neighbor) continue;

    const xMin = dx < 0 ? 0 : dx > 0 ? CORE_MAX + 1 : CORE_MIN;
    const xMax = dx < 0 ? CORE_MIN - 1 : dx > 0 ? SAMPLES - 1 : CORE_MAX;
    const yMin = dy < 0 ? 0 : dy > 0 ? CORE_MAX + 1 : CORE_MIN;
    const yMax = dy < 0 ? CORE_MIN - 1 : dy > 0 ? SAMPLES - 1 : CORE_MAX;
    const zMin = dz < 0 ? 0 : dz > 0 ? CORE_MAX + 1 : CORE_MIN;
    const zMax = dz < 0 ? CORE_MIN - 1 : dz > 0 ? SAMPLES - 1 : CORE_MAX;

    for (let lz = zMin; lz <= zMax; lz++) {
      const srcZ = lz - dz * CHUNK_SIZE;
      for (let ly = yMin; ly <= yMax; ly++) {
        const srcY = ly - dy * CHUNK_SIZE;
        for (let lx = xMin; lx <= xMax; lx++) {
          const srcX = lx - dx * CHUNK_SIZE;
          chunk.field[lx + ly * SAMPLES + lz * SAMPLES_SQ] = neighbor.field[srcX + srcY * SAMPLES + srcZ * SAMPLES_SQ];
        }
      }
    }
  }
}

export function neighborChunkIds(coord: ChunkCoord): string[] {
  const ids: string[] = [];
  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
    ids.push(chunkId({ cx: coord.cx + dx, cy: coord.cy + dy, cz: coord.cz + dz }));
  }
  return ids;
}
