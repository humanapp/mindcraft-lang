import type { ChunkCoord } from "./types";
import { CHUNK_SIZE, chunkId, FIELD_PAD, sampleIndex } from "./types";

export interface TerrainPatch {
  readonly chunkId: string;
  readonly index: number;
  readonly before: number;
  readonly after: number;
}

export interface BrushParams {
  readonly radius: number;
  // Voxels of surface displacement per second at the brush center (before
  // falloff). Multiplied by dt each tick then converted to a density delta
  // via the local field gradient.
  readonly strength: number;
}

// The base terrain generator uses `density = height - wy`, giving a vertical
// gradient of exactly 1.0 density unit per voxel. All brush scaling is
// relative to this value. If the generator changes, update this constant.
const FIELD_GRADIENT = 1.0;

// Convert a desired surface displacement (in voxels) to the density delta
// needed to achieve it, given the local field gradient.
function displacementToDelta(voxels: number): number {
  return voxels * FIELD_GRADIENT;
}

/**
 * Compute density field edits for a spherical brush centered at a world position.
 * Returns patches with before/after values suitable for undo.
 *
 * `dt` is the time step in seconds. brush.strength (voxels/second) is
 * multiplied by dt so the total displacement over any wall-clock interval
 * is the same regardless of event or frame rate.
 */
export function computeBrushPatches(
  worldPos: [number, number, number],
  brush: BrushParams,
  raise: boolean,
  chunks: ReadonlyMap<string, { coord: ChunkCoord; field: Float32Array }>,
  dt: number,
  debug = false
): TerrainPatch[] {
  const [wx, wy, wz] = worldPos;
  const r = brush.radius;
  const rSq = r * r;
  const patches: TerrainPatch[] = [];
  let debugSamples = 0;

  const cxMin = Math.floor((wx - r) / CHUNK_SIZE);
  const cxMax = Math.floor((wx + r) / CHUNK_SIZE);
  const cyMin = Math.floor((wy - r) / CHUNK_SIZE);
  const cyMax = Math.floor((wy + r) / CHUNK_SIZE);
  const czMin = Math.floor((wz - r) / CHUNK_SIZE);
  const czMax = Math.floor((wz + r) / CHUNK_SIZE);

  const overlapping: [string, { coord: ChunkCoord; field: Float32Array }][] = [];
  for (let cz = czMin; cz <= czMax; cz++) {
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const id = chunkId({ cx, cy, cz });
        const chunk = chunks.get(id);
        if (chunk) overlapping.push([id, chunk]);
      }
    }
  }

  for (const [id, chunk] of overlapping) {
    const ox = chunk.coord.cx * CHUNK_SIZE;
    const oy = chunk.coord.cy * CHUNK_SIZE;
    const oz = chunk.coord.cz * CHUNK_SIZE;

    const clampMax = CHUNK_SIZE + 1;
    const lxMin = Math.max(0, Math.floor(wx - r - ox));
    const lxMax = Math.min(clampMax, Math.ceil(wx + r - ox));
    const lyMin = Math.max(0, Math.floor(wy - r - oy));
    const lyMax = Math.min(clampMax, Math.ceil(wy + r - oy));
    const lzMin = Math.max(0, Math.floor(wz - r - oz));
    const lzMax = Math.min(clampMax, Math.ceil(wz + r - oz));

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
          const t = dist / r;
          // Smoothstep falloff: 1 at center, 0 at edge, zero derivative at
          // both ends. Tighter than (1-t)^2 -- concentrates effect near the
          // center and reduces the broad plateau that causes thick active-cell
          // bands during additive painting.
          const falloff = 1 - t * t * (3 - 2 * t);
          const delta = displacementToDelta(brush.strength * dt) * falloff * (raise ? 1 : -1);

          const idx = sampleIndex(lx + FIELD_PAD, ly + FIELD_PAD, lz + FIELD_PAD);
          const before = chunk.field[idx];
          const after = before + delta;

          if (debug && debugSamples < 8 && dist < 2) {
            console.log(
              `[brush-sample] world=(${(ox + lx).toFixed(1)},${(oy + ly).toFixed(1)},${(oz + lz).toFixed(1)})` +
                ` dist=${dist.toFixed(2)} falloff=${falloff.toFixed(3)} delta=${delta.toFixed(4)}` +
                ` before=${before.toFixed(4)} after=${after.toFixed(4)}`
            );
            debugSamples++;
          }

          patches.push({ chunkId: id, index: idx, before, after });
        }
      }
    }

    if (debug && debugSamples > 0) {
      const centerLx = Math.round(wx - ox);
      const centerLz = Math.round(wz - oz);
      if (centerLx >= 0 && centerLx <= CHUNK_SIZE + 1 && centerLz >= 0 && centerLz <= CHUNK_SIZE + 1) {
        const lyLow = Math.max(0, Math.floor(wy - oy) - 4);
        const lyHigh = Math.min(CHUNK_SIZE + 1, Math.floor(wy - oy) + 4);
        const gradient: string[] = [];
        for (let ly = lyLow; ly <= lyHigh; ly++) {
          const idx = sampleIndex(centerLx + FIELD_PAD, ly + FIELD_PAD, centerLz + FIELD_PAD);
          const d = chunk.field[idx];
          gradient.push(`  y=${(oy + ly).toFixed(0)} density=${d.toFixed(4)}`);
        }
        console.log(
          `[brush-gradient] vertical column at x=${ox + centerLx}, z=${oz + centerLz}:\n${gradient.join("\n")}`
        );
      }
    }
  }

  if (debug && patches.length > 0) {
    console.log(`[brush-info] radius=${r} strength=${brush.strength} raise=${raise} patchCount=${patches.length}`);
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
