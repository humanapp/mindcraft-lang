import type { ChunkCoord, MeshData } from "./types";
import { CHUNK_SIZE, SAMPLES, sampleIndex } from "./types";

// Corner offsets for a voxel cell: corner index -> (dx, dy, dz)
const CORNERS: [number, number, number][] = [
  [0, 0, 0], // 0
  [1, 0, 0], // 1
  [0, 1, 0], // 2
  [1, 1, 0], // 3
  [0, 0, 1], // 4
  [1, 0, 1], // 5
  [0, 1, 1], // 6
  [1, 1, 1], // 7
];

// 12 edges of a cube as pairs of corner indices
const CUBE_EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

function clampedGradient(field: Float32Array, gx: number, gy: number, gz: number): [number, number, number] {
  const maxS = SAMPLES - 1;
  const x0 = gx > 0 ? field[sampleIndex(gx - 1, gy, gz)] : field[sampleIndex(gx, gy, gz)];
  const x1 = gx < maxS ? field[sampleIndex(gx + 1, gy, gz)] : field[sampleIndex(gx, gy, gz)];
  const y0 = gy > 0 ? field[sampleIndex(gx, gy - 1, gz)] : field[sampleIndex(gx, gy, gz)];
  const y1 = gy < maxS ? field[sampleIndex(gx, gy + 1, gz)] : field[sampleIndex(gx, gy, gz)];
  const z0 = gz > 0 ? field[sampleIndex(gx, gy, gz - 1)] : field[sampleIndex(gx, gy, gz)];
  const z1 = gz < maxS ? field[sampleIndex(gx, gy, gz + 1)] : field[sampleIndex(gx, gy, gz)];
  return [x0 - x1, y0 - y1, z0 - z1];
}

/**
 * Surface Nets isosurface extraction.
 *
 * Phase 1: For each voxel cell, determine if the isosurface crosses it.
 *          If so, compute a representative vertex by averaging edge crossing points.
 * Phase 2: For each grid edge that crosses the isosurface, emit a quad (2 tris)
 *          connecting the 4 cells that share that edge.
 */
export function extractSurfaceNets(field: Float32Array, coord: ChunkCoord): MeshData {
  const meshDim = CHUNK_SIZE + 1;
  const cellCount = meshDim * meshDim * meshDim;

  // Phase 1: Compute cell vertices
  const cellVertex = new Int32Array(cellCount).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  let vertCount = 0;

  const wx0 = coord.cx * CHUNK_SIZE;
  const wy0 = coord.cy * CHUNK_SIZE;
  const wz0 = coord.cz * CHUNK_SIZE;

  for (let cz = 0; cz < meshDim; cz++) {
    for (let cy = 0; cy < meshDim; cy++) {
      for (let cx = 0; cx < meshDim; cx++) {
        const d: number[] = new Array(8);
        for (let i = 0; i < 8; i++) {
          const [dx, dy, dz] = CORNERS[i];
          d[i] = field[sampleIndex(cx + dx, cy + dy, cz + dz)];
        }

        let mask = 0;
        for (let i = 0; i < 8; i++) {
          if (d[i] > 0) mask |= 1 << i;
        }
        if (mask === 0 || mask === 0xff) continue;

        let vx = 0;
        let vy = 0;
        let vz = 0;
        let crossings = 0;

        for (const [a, b] of CUBE_EDGES) {
          if (d[a] > 0 !== d[b] > 0) {
            const t = d[a] / (d[a] - d[b]);
            vx += CORNERS[a][0] + t * (CORNERS[b][0] - CORNERS[a][0]);
            vy += CORNERS[a][1] + t * (CORNERS[b][1] - CORNERS[a][1]);
            vz += CORNERS[a][2] + t * (CORNERS[b][2] - CORNERS[a][2]);
            crossings++;
          }
        }

        if (crossings === 0) continue;

        const inv = 1 / crossings;
        const px = cx + vx * inv;
        const py = cy + vy * inv;
        const pz = cz + vz * inv;

        // Normal from density gradient at the nearest grid point
        const nearGx = Math.round(px);
        const nearGy = Math.round(py);
        const nearGz = Math.round(pz);
        const cgx = Math.min(Math.max(nearGx, 0), SAMPLES - 1);
        const cgy = Math.min(Math.max(nearGy, 0), SAMPLES - 1);
        const cgz = Math.min(Math.max(nearGz, 0), SAMPLES - 1);
        const [gx, gy, gz] = clampedGradient(field, cgx, cgy, cgz);

        const glen = Math.sqrt(gx * gx + gy * gy + gz * gz);
        const invLen = glen > 1e-8 ? 1 / glen : 0;

        const cellIdx = cx + cy * meshDim + cz * meshDim * meshDim;
        cellVertex[cellIdx] = vertCount;
        positions.push(wx0 + px, wy0 + py, wz0 + pz);
        normals.push(gx * invLen, gy * invLen, gz * invLen);
        vertCount++;
      }
    }
  }

  // Phase 2: Generate quads for crossing edges
  const indices: number[] = [];

  function cellVert(cx: number, cy: number, cz: number): number {
    if (cx < 0 || cx >= meshDim || cy < 0 || cy >= meshDim || cz < 0 || cz >= meshDim) return -1;
    return cellVertex[cx + cy * meshDim + cz * meshDim * meshDim];
  }

  // X-edges: from (gx, gy, gz) to (gx+1, gy, gz)
  for (let gz = 1; gz < meshDim; gz++) {
    for (let gy = 1; gy < meshDim; gy++) {
      for (let gx = 0; gx < meshDim; gx++) {
        const d0 = field[sampleIndex(gx, gy, gz)];
        const d1 = field[sampleIndex(gx + 1, gy, gz)];
        if (d0 > 0 === d1 > 0) continue;

        const a = cellVert(gx, gy - 1, gz - 1);
        const b = cellVert(gx, gy, gz - 1);
        const c = cellVert(gx, gy, gz);
        const dd = cellVert(gx, gy - 1, gz);
        if (a < 0 || b < 0 || c < 0 || dd < 0) continue;

        if (d0 > 0) {
          indices.push(a, dd, c, a, c, b);
        } else {
          indices.push(a, b, c, a, c, dd);
        }
      }
    }
  }

  // Y-edges: from (gx, gy, gz) to (gx, gy+1, gz)
  for (let gz = 1; gz < meshDim; gz++) {
    for (let gy = 0; gy < meshDim; gy++) {
      for (let gx = 1; gx < meshDim; gx++) {
        const d0 = field[sampleIndex(gx, gy, gz)];
        const d1 = field[sampleIndex(gx, gy + 1, gz)];
        if (d0 > 0 === d1 > 0) continue;

        const a = cellVert(gx - 1, gy, gz - 1);
        const b = cellVert(gx - 1, gy, gz);
        const c = cellVert(gx, gy, gz);
        const dd = cellVert(gx, gy, gz - 1);
        if (a < 0 || b < 0 || c < 0 || dd < 0) continue;

        if (d0 > 0) {
          indices.push(a, b, c, a, c, dd);
        } else {
          indices.push(a, dd, c, a, c, b);
        }
      }
    }
  }

  // Z-edges: from (gx, gy, gz) to (gx, gy, gz+1)
  for (let gz = 0; gz < meshDim; gz++) {
    for (let gy = 1; gy < meshDim; gy++) {
      for (let gx = 1; gx < meshDim; gx++) {
        const d0 = field[sampleIndex(gx, gy, gz)];
        const d1 = field[sampleIndex(gx, gy, gz + 1)];
        if (d0 > 0 === d1 > 0) continue;

        const a = cellVert(gx - 1, gy - 1, gz);
        const b = cellVert(gx, gy - 1, gz);
        const c = cellVert(gx, gy, gz);
        const dd = cellVert(gx - 1, gy, gz);
        if (a < 0 || b < 0 || c < 0 || dd < 0) continue;

        if (d0 > 0) {
          indices.push(a, dd, c, a, c, b);
        } else {
          indices.push(a, b, c, a, c, dd);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    vertexCount: vertCount,
    indexCount: indices.length,
  };
}
