import type { ChunkCoord } from "./types";
import { CHUNK_SIZE, SAMPLES, sampleIndex } from "./types";

export interface TerrainPatch {
  readonly chunkId: string;
  readonly index: number;
  readonly before: number;
  readonly after: number;
}

export interface BrushParams {
  readonly radius: number;
  readonly strength: number;
}

/**
 * Compute density field edits for a spherical brush centered at a world position.
 * Returns patches with before/after values suitable for undo.
 */
export function computeBrushPatches(
  worldPos: [number, number, number],
  brush: BrushParams,
  raise: boolean,
  chunks: ReadonlyMap<string, { coord: ChunkCoord; field: Float32Array }>
): TerrainPatch[] {
  const [wx, wy, wz] = worldPos;
  const r = brush.radius;
  const rSq = r * r;
  const patches: TerrainPatch[] = [];

  for (const [chunkId, chunk] of chunks) {
    const ox = chunk.coord.cx * CHUNK_SIZE;
    const oy = chunk.coord.cy * CHUNK_SIZE;
    const oz = chunk.coord.cz * CHUNK_SIZE;

    const lxMin = Math.max(0, Math.floor(wx - r - ox));
    const lxMax = Math.min(SAMPLES - 1, Math.ceil(wx + r - ox));
    const lyMin = Math.max(0, Math.floor(wy - r - oy));
    const lyMax = Math.min(SAMPLES - 1, Math.ceil(wy + r - oy));
    const lzMin = Math.max(0, Math.floor(wz - r - oz));
    const lzMax = Math.min(SAMPLES - 1, Math.ceil(wz + r - oz));

    if (lxMin > lxMax || lyMin > lyMax || lzMin > lzMax) continue;

    for (let lz = lzMin; lz <= lzMax; lz++) {
      for (let ly = lyMin; ly <= lyMax; ly++) {
        for (let lx = lxMin; lx <= lxMax; lx++) {
          const sx = ox + lx - wx;
          const sy = oy + ly - wy;
          const sz = oz + lz - wz;
          const distSq = sx * sx + sy * sy + sz * sz;

          if (distSq > rSq) continue;

          const dist = Math.sqrt(distSq);
          const falloff = 1 - dist / r;
          const delta = brush.strength * falloff * falloff * (raise ? 1 : -1);

          const idx = sampleIndex(lx, ly, lz);
          const before = chunk.field[idx];
          const after = before + delta;

          patches.push({ chunkId, index: idx, before, after });
        }
      }
    }
  }

  return patches;
}

export function affectedChunkIds(patches: ReadonlyArray<TerrainPatch>): Set<string> {
  const ids = new Set<string>();
  for (const p of patches) {
    ids.add(p.chunkId);
  }
  return ids;
}
