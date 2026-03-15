import { baselineDensity } from "./generator";
import type { ChunkCoord } from "./types";
import { CHUNK_SIZE, chunkId, FIELD_PAD, SAMPLES, SAMPLES_SQ, sampleIndex } from "./types";

export interface TerrainPatch {
  readonly chunkId: string;
  readonly index: number;
  readonly before: number;
  readonly after: number;
}

export type BrushShape = "sphere" | "cube" | "cylinder";

export type BrushMode = "raise" | "lower" | "smooth" | "roughen" | "flatten";

export interface BrushParams {
  readonly radius: number;
  // Voxels of surface displacement per second at the brush center (before
  // falloff). Multiplied by dt each tick then converted to a density delta
  // via the local field gradient.
  readonly strength: number;
  readonly shape: BrushShape;
  // Controls the falloff curve steepness. 1.0 = standard smoothstep,
  // <1 = flatter/broader, >1 = sharper/more peaked.
  readonly falloff: number;
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

// Remap the raw slider strength so low/medium values stay controlled while
// high values ramp up aggressively. The cubic term dominates above ~10.
//   0.5 -> 0.5,  3 -> 3.6,  10 -> 32,  20 -> 198
function effectiveStrength(raw: number): number {
  return raw + (raw * raw * raw) / 45;
}

function sampleFieldAt(
  chunks: ReadonlyMap<string, { coord: ChunkCoord; field: Float32Array }>,
  wx: number,
  wy: number,
  wz: number,
  fallback: number
): number {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const chunk = chunks.get(chunkId({ cx, cy, cz }));
  if (!chunk) return fallback;
  const lx = wx - cx * CHUNK_SIZE;
  const ly = wy - cy * CHUNK_SIZE;
  const lz = wz - cz * CHUNK_SIZE;
  return chunk.field[sampleIndex(lx + FIELD_PAD, ly + FIELD_PAD, lz + FIELD_PAD)];
}

function noiseHash(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177) | 0;
  h = (((h ^ (h >> 13)) >>> 0) * 1103515245 + 12345) | 0;
  return ((h & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}

function smoothNoise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const v00 = noiseHash(ix, iy, iz) + (noiseHash(ix + 1, iy, iz) - noiseHash(ix, iy, iz)) * fx;
  const v10 = noiseHash(ix, iy + 1, iz) + (noiseHash(ix + 1, iy + 1, iz) - noiseHash(ix, iy + 1, iz)) * fx;
  const v01 = noiseHash(ix, iy, iz + 1) + (noiseHash(ix + 1, iy, iz + 1) - noiseHash(ix, iy, iz + 1)) * fx;
  const v11 = noiseHash(ix, iy + 1, iz + 1) + (noiseHash(ix + 1, iy + 1, iz + 1) - noiseHash(ix, iy + 1, iz + 1)) * fx;
  const v0 = v00 + (v10 - v00) * fy;
  const v1 = v01 + (v11 - v01) * fy;
  return v0 + (v1 - v0) * fz;
}

const ROUGHEN_NOISE_SCALE = 0.3;

function computeFalloff(
  shape: BrushShape,
  sx: number,
  sy: number,
  sz: number,
  r: number,
  falloffExp: number
): number | null {
  let t: number;
  switch (shape) {
    case "sphere": {
      const distSq = sx * sx + sy * sy + sz * sz;
      if (distSq > r * r) return null;
      t = Math.sqrt(distSq) / r;
      break;
    }
    case "cube": {
      const ax = Math.abs(sx);
      const ay = Math.abs(sy);
      const az = Math.abs(sz);
      if (ax > r || ay > r || az > r) return null;
      t = Math.max(ax, ay, az) / r;
      break;
    }
    case "cylinder": {
      const distSqXZ = sx * sx + sz * sz;
      if (distSqXZ > r * r || Math.abs(sy) > r) return null;
      const tRadial = Math.sqrt(distSqXZ) / r;
      const tVertical = Math.abs(sy) / r;
      t = Math.max(tRadial, tVertical);
      break;
    }
  }
  const shaped = t ** falloffExp;
  return 1 - shaped * shaped * (3 - 2 * shaped);
}

/**
 * Compute density field edits for a brush centered at a world position.
 * Returns patches with before/after values suitable for undo.
 *
 * `dt` is the time step in seconds. brush.strength (voxels/second) is
 * multiplied by dt so the total displacement over any wall-clock interval
 * is the same regardless of event or frame rate.
 *
 * For `flatten` mode, `flattenTarget` is the world-space Y height the brush
 * drives the surface toward; it should be captured once at stroke start.
 */
export function computeBrushPatches(
  worldPos: [number, number, number],
  brush: BrushParams,
  mode: BrushMode,
  chunks: ReadonlyMap<string, { coord: ChunkCoord; field: Float32Array }>,
  dt: number,
  flattenTarget?: number,
  debug = false
): TerrainPatch[] {
  const [wx, wy, wz] = worldPos;
  const r = brush.radius;
  const shape = brush.shape ?? "sphere";
  const falloffExp = brush.falloff ?? 1;
  const patches: TerrainPatch[] = [];
  let debugSamples = 0;

  const displacementPerTick = effectiveStrength(brush.strength) * dt;
  const blendFactor = 1 - Math.exp(-effectiveStrength(brush.strength) * dt);

  const coreExtent = CHUNK_SIZE + 1;
  const cxMin = Math.ceil((wx - r - coreExtent) / CHUNK_SIZE);
  const cxMax = Math.floor((wx + r) / CHUNK_SIZE);
  const cyMin = Math.ceil((wy - r - coreExtent) / CHUNK_SIZE);
  const cyMax = Math.floor((wy + r) / CHUNK_SIZE);
  const czMin = Math.ceil((wz - r - coreExtent) / CHUNK_SIZE);
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

          const falloff = computeFalloff(shape, sx, sy, sz, r, falloffExp);
          if (falloff === null) continue;

          const idx = sampleIndex(lx + FIELD_PAD, ly + FIELD_PAD, lz + FIELD_PAD);
          const before = chunk.field[idx];
          let after: number;

          switch (mode) {
            case "raise":
              after = before + displacementToDelta(displacementPerTick) * falloff;
              break;
            case "lower": {
              after = before - displacementToDelta(displacementPerTick) * falloff;
              if (before > 0 && after <= 0) {
                after = Math.min(after, baselineDensity(ox + lx, oy + ly, oz + lz));
              }
              break;
            }
            case "smooth": {
              const wvx = ox + lx;
              const wvy = oy + ly;
              const wvz = oz + lz;
              const avg =
                (sampleFieldAt(chunks, wvx - 1, wvy, wvz, before) +
                  sampleFieldAt(chunks, wvx + 1, wvy, wvz, before) +
                  sampleFieldAt(chunks, wvx, wvy - 1, wvz, before) +
                  sampleFieldAt(chunks, wvx, wvy + 1, wvz, before) +
                  sampleFieldAt(chunks, wvx, wvy, wvz - 1, before) +
                  sampleFieldAt(chunks, wvx, wvy, wvz + 1, before)) /
                6;
              after = before + (avg - before) * blendFactor * falloff;
              break;
            }
            case "roughen": {
              const noise = smoothNoise3D(
                (ox + lx) * ROUGHEN_NOISE_SCALE,
                (oy + ly) * ROUGHEN_NOISE_SCALE,
                (oz + lz) * ROUGHEN_NOISE_SCALE
              );
              const band = Math.max(0, 1 - Math.abs(before) / r);
              const surfaceWeight = band * band * (3 - 2 * band);
              after = before + displacementToDelta(displacementPerTick) * falloff * noise * surfaceWeight;
              break;
            }
            case "flatten": {
              const targetDensity = (flattenTarget ?? oy + ly) - (oy + ly);
              after = before + (targetDensity - before) * blendFactor * falloff;
              break;
            }
          }

          if (debug && debugSamples < 8) {
            const dist = Math.sqrt(sx * sx + sy * sy + sz * sz);
            if (dist < 2) {
              console.log(
                `[brush-sample] world=(${(ox + lx).toFixed(1)},${(oy + ly).toFixed(1)},${(oz + lz).toFixed(1)})` +
                  ` dist=${dist.toFixed(2)} falloff=${falloff.toFixed(3)}` +
                  ` before=${before.toFixed(4)} after=${after.toFixed(4)}`
              );
              debugSamples++;
            }
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
          const gIdx = sampleIndex(centerLx + FIELD_PAD, ly + FIELD_PAD, centerLz + FIELD_PAD);
          const d = chunk.field[gIdx];
          gradient.push(`  y=${(oy + ly).toFixed(0)} density=${d.toFixed(4)}`);
        }
        console.log(
          `[brush-gradient] vertical column at x=${ox + centerLx}, z=${oz + centerLz}:\n${gradient.join("\n")}`
        );
      }
    }
  }

  if (debug && patches.length > 0) {
    console.log(`[brush-info] radius=${r} strength=${brush.strength} mode=${mode} patchCount=${patches.length}`);
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
