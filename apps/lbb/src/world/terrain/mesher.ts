import type { ChunkCoord, MeshData } from "./types";
import {
  CORE_SAMPLES,
  chunkWorldOrigin,
  FIELD_PAD,
  localVoxelToSampleIndex,
  SAMPLES,
  SAMPLES_SQ,
  sampleIndex,
} from "./types";

const CORNER_OFFSETS = [
  0,
  1,
  SAMPLES,
  SAMPLES + 1,
  SAMPLES_SQ,
  SAMPLES_SQ + 1,
  SAMPLES_SQ + SAMPLES,
  SAMPLES_SQ + SAMPLES + 1,
];

const CORNERS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

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

function sampleFieldTrilinear(field: Float32Array, x: number, y: number, z: number): number {
  x += FIELD_PAD;
  y += FIELD_PAD;
  z += FIELD_PAD;
  const maxS = SAMPLES - 1;
  const fx = Math.min(Math.max(x, 0), maxS);
  const fy = Math.min(Math.max(y, 0), maxS);
  const fz = Math.min(Math.max(z, 0), maxS);

  const x0 = Math.min(Math.floor(fx), maxS - 1);
  const y0 = Math.min(Math.floor(fy), maxS - 1);
  const z0 = Math.min(Math.floor(fz), maxS - 1);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const mx = 1 - tx;
  const my = 1 - ty;
  const mz = 1 - tz;

  return (
    field[sampleIndex(x0, y0, z0)] * mx * my * mz +
    field[sampleIndex(x1, y0, z0)] * tx * my * mz +
    field[sampleIndex(x0, y1, z0)] * mx * ty * mz +
    field[sampleIndex(x1, y1, z0)] * tx * ty * mz +
    field[sampleIndex(x0, y0, z1)] * mx * my * tz +
    field[sampleIndex(x1, y0, z1)] * tx * my * tz +
    field[sampleIndex(x0, y1, z1)] * mx * ty * tz +
    field[sampleIndex(x1, y1, z1)] * tx * ty * tz
  );
}

function catmullRomWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [0.5 * (-t3 + 2 * t2 - t), 0.5 * (3 * t3 - 5 * t2 + 2), 0.5 * (-3 * t3 + 4 * t2 + t), 0.5 * (t3 - t2)];
}

function catmullRomDerivWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  return [0.5 * (-3 * t2 + 4 * t - 1), 0.5 * (9 * t2 - 10 * t), 0.5 * (-9 * t2 + 8 * t + 1), 0.5 * (3 * t2 - 2 * t)];
}

function sampleGradientTricubic(field: Float32Array, x: number, y: number, z: number, gradOut: Float64Array): void {
  x += FIELD_PAD;
  y += FIELD_PAD;
  z += FIELD_PAD;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);

  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;

  const [wx0, wx1, wx2, wx3] = catmullRomWeights(tx);
  const [wy0, wy1, wy2, wy3] = catmullRomWeights(ty);
  const [wz0, wz1, wz2, wz3] = catmullRomWeights(tz);
  const [dwx0, dwx1, dwx2, dwx3] = catmullRomDerivWeights(tx);
  const [dwy0, dwy1, dwy2, dwy3] = catmullRomDerivWeights(ty);
  const [dwz0, dwz1, dwz2, dwz3] = catmullRomDerivWeights(tz);

  let gx = 0;
  let gy = 0;
  let gz = 0;

  const maxIdx = SAMPLES - 1;
  const wyA = [wy0, wy1, wy2, wy3] as const;
  const wzA = [wz0, wz1, wz2, wz3] as const;
  const dwyA = [dwy0, dwy1, dwy2, dwy3] as const;
  const dwzA = [dwz0, dwz1, dwz2, dwz3] as const;
  for (let k = 0; k < 4; k++) {
    const sz = Math.min(Math.max(z0 - 1 + k, 0), maxIdx);
    for (let j = 0; j < 4; j++) {
      const sy = Math.min(Math.max(y0 - 1 + j, 0), maxIdx);
      const wyz = wyA[j] * wzA[k];
      const dwyz = dwyA[j] * wzA[k];
      const wydz = wyA[j] * dwzA[k];

      const s0 = Math.min(Math.max(x0 - 1, 0), maxIdx);
      const s1 = Math.min(Math.max(x0, 0), maxIdx);
      const s2 = Math.min(Math.max(x0 + 1, 0), maxIdx);
      const s3 = Math.min(Math.max(x0 + 2, 0), maxIdx);
      const v0 = field[sampleIndex(s0, sy, sz)];
      const v1 = field[sampleIndex(s1, sy, sz)];
      const v2 = field[sampleIndex(s2, sy, sz)];
      const v3 = field[sampleIndex(s3, sy, sz)];
      gx += v0 * dwx0 * wyz + v1 * dwx1 * wyz + v2 * dwx2 * wyz + v3 * dwx3 * wyz;
      gy += v0 * wx0 * dwyz + v1 * wx1 * dwyz + v2 * wx2 * dwyz + v3 * wx3 * dwyz;
      gz += v0 * wx0 * wydz + v1 * wx1 * wydz + v2 * wx2 * wydz + v3 * wx3 * wydz;
    }
  }

  gradOut[0] = gx;
  gradOut[1] = gy;
  gradOut[2] = gz;
}

function emptyMesh(): MeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    gradientMag: new Float32Array(0),
    indices: new Uint32Array(0),
    vertexCount: 0,
    indexCount: 0,
  };
}

function isUniformSign(field: Float32Array): boolean {
  const gMin = FIELD_PAD;
  const gMax = FIELD_PAD + CORE_SAMPLES;
  const firstSign = field[gMin + gMin * SAMPLES + gMin * SAMPLES_SQ] > 0;
  for (let gz = gMin; gz <= gMax; gz++) {
    const zOff = gz * SAMPLES_SQ;
    for (let gy = gMin; gy <= gMax; gy++) {
      const yzOff = gy * SAMPLES + zOff;
      for (let gx = gMin; gx <= gMax; gx++) {
        if (field[gx + yzOff] > 0 !== firstSign) return false;
      }
    }
  }
  return true;
}

export interface MesherOptions {
  readonly normalSmoothingIterations?: number;
  readonly vertexRelaxation?: boolean;
}

const RELAX_NEIGHBOR_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

/**
 * Surface Nets isosurface extraction.
 *
 * Phase 1: For each voxel cell, determine if the isosurface crosses it.
 *          If so, compute a representative vertex by averaging edge crossing points.
 * Phase 2: For each grid edge that crosses the isosurface, emit a quad (2 tris)
 *          connecting the 4 cells that share that edge.
 */
export function extractSurfaceNets(field: Float32Array, coord: ChunkCoord, options: MesherOptions = {}): MeshData {
  const { normalSmoothingIterations = 0, vertexRelaxation = false } = options;

  if (isUniformSign(field)) return emptyMesh();

  const meshDim = CORE_SAMPLES;
  const cellCount = meshDim * meshDim * meshDim;
  const cellVertex = new Int32Array(cellCount).fill(-1);
  const positions = new Float32Array(cellCount * 3);
  const normals = new Float32Array(cellCount * 3);
  const boundaryFlags = new Uint8Array(cellCount);
  const indices = new Uint32Array(3 * meshDim * (meshDim - 1) * (meshDim - 1) * 6);
  const d = new Float64Array(8);
  const grad = new Float64Array(3);

  // Phase 1: Compute cell vertices
  let vertCount = 0;

  const [wx0, wy0, wz0] = chunkWorldOrigin(coord);

  for (let cz = 0; cz < meshDim; cz++) {
    for (let cy = 0; cy < meshDim; cy++) {
      for (let cx = 0; cx < meshDim; cx++) {
        const base = localVoxelToSampleIndex(cx, cy, cz);
        for (let i = 0; i < 8; i++) d[i] = field[base + CORNER_OFFSETS[i]];

        let mask = 0;
        for (let i = 0; i < 8; i++) {
          if (d[i] > 0) mask |= 1 << i;
        }
        if (mask === 0 || mask === 0xff) continue;

        let vx = 0;
        let vy = 0;
        let vz = 0;
        let crossings = 0;

        for (let e = 0; e < 12; e++) {
          const a = CUBE_EDGES[e][0];
          const b = CUBE_EDGES[e][1];
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

        const cellIdx = cx + cy * meshDim + cz * meshDim * meshDim;
        cellVertex[cellIdx] = vertCount;
        const vi3 = vertCount * 3;
        positions[vi3] = wx0 + px;
        positions[vi3 + 1] = wy0 + py;
        positions[vi3 + 2] = wz0 + pz;
        const lastCell = meshDim - 1;
        boundaryFlags[vertCount] =
          cx === 0 || cx === lastCell || cy === 0 || cy === lastCell || cz === 0 || cz === lastCell ? 1 : 0;
        vertCount++;
      }
    }
  }

  // Vertex relaxation: smooth positions by averaging with grid neighbors
  const RELAX_ITERATIONS = vertexRelaxation ? 2 : 0;
  const RELAX_FACTOR = 0.5;

  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    const newPos = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount * 3; i++) newPos[i] = positions[i];

    const lastCell = meshDim - 1;
    for (let cz = 0; cz < meshDim; cz++) {
      for (let cy = 0; cy < meshDim; cy++) {
        for (let cx = 0; cx < meshDim; cx++) {
          if (cx === 0 || cx === lastCell || cy === 0 || cy === lastCell || cz === 0 || cz === lastCell) continue;
          const cellIdx = cx + cy * meshDim + cz * meshDim * meshDim;
          const vi = cellVertex[cellIdx];
          if (vi < 0) continue;

          let avgX = 0;
          let avgY = 0;
          let avgZ = 0;
          let nCount = 0;

          for (const [dx, dy, dz] of RELAX_NEIGHBOR_OFFSETS) {
            const nx = cx + dx;
            const ny = cy + dy;
            const nz = cz + dz;
            if (nx < 0 || nx >= meshDim || ny < 0 || ny >= meshDim || nz < 0 || nz >= meshDim) continue;
            const ni = cellVertex[nx + ny * meshDim + nz * meshDim * meshDim];
            if (ni < 0) continue;
            avgX += positions[ni * 3];
            avgY += positions[ni * 3 + 1];
            avgZ += positions[ni * 3 + 2];
            nCount++;
          }

          if (nCount > 0) {
            const inv = 1 / nCount;
            const vi3 = vi * 3;
            newPos[vi3] = positions[vi3] + RELAX_FACTOR * (avgX * inv - positions[vi3]);
            newPos[vi3 + 1] = positions[vi3 + 1] + RELAX_FACTOR * (avgY * inv - positions[vi3 + 1]);
            newPos[vi3 + 2] = positions[vi3 + 2] + RELAX_FACTOR * (avgZ * inv - positions[vi3 + 2]);
          }
        }
      }
    }

    for (let i = 0; i < vertCount * 3; i++) positions[i] = newPos[i];
  }

  const gradientMag = new Float32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    sampleGradientTricubic(field, positions[i * 3] - wx0, positions[i * 3 + 1] - wy0, positions[i * 3 + 2] - wz0, grad);
    const gx = grad[0];
    const gy = grad[1];
    const gz = grad[2];
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
    gradientMag[i] = len;
    const invLen = len > 1e-8 ? 1 / len : 0;
    normals[i * 3] = -gx * invLen;
    normals[i * 3 + 1] = -gy * invLen;
    normals[i * 3 + 2] = -gz * invLen;
  }

  // Phase 2: Generate quads for crossing edges
  let idxCount = 0;

  function cellVert(cx: number, cy: number, cz: number): number {
    if (cx < 0 || cx >= meshDim || cy < 0 || cy >= meshDim || cz < 0 || cz >= meshDim) return -1;
    return cellVertex[cx + cy * meshDim + cz * meshDim * meshDim];
  }

  // X-edges: from (gx, gy, gz) to (gx+1, gy, gz)
  for (let gz = 1; gz < meshDim; gz++) {
    for (let gy = 1; gy < meshDim; gy++) {
      for (let gx = 0; gx < meshDim; gx++) {
        const d0 = field[localVoxelToSampleIndex(gx, gy, gz)];
        const d1 = field[localVoxelToSampleIndex(gx + 1, gy, gz)];
        if (d0 > 0 === d1 > 0) continue;

        const a = cellVert(gx, gy - 1, gz - 1);
        const b = cellVert(gx, gy, gz - 1);
        const c = cellVert(gx, gy, gz);
        const dd = cellVert(gx, gy - 1, gz);
        if (a < 0 || b < 0 || c < 0 || dd < 0) continue;

        if (d0 > 0) {
          indices[idxCount++] = a;
          indices[idxCount++] = b;
          indices[idxCount++] = c;
          indices[idxCount++] = a;
          indices[idxCount++] = c;
          indices[idxCount++] = dd;
        } else {
          indices[idxCount++] = a;
          indices[idxCount++] = dd;
          indices[idxCount++] = c;
          indices[idxCount++] = a;
          indices[idxCount++] = c;
          indices[idxCount++] = b;
        }
      }
    }
  }

  // Y-edges: from (gx, gy, gz) to (gx, gy+1, gz)
  for (let gz = 1; gz < meshDim; gz++) {
    for (let gy = 0; gy < meshDim; gy++) {
      for (let gx = 1; gx < meshDim; gx++) {
        const d0 = field[localVoxelToSampleIndex(gx, gy, gz)];
        const d1 = field[localVoxelToSampleIndex(gx, gy + 1, gz)];
        if (d0 > 0 === d1 > 0) continue;

        const a = cellVert(gx - 1, gy, gz - 1);
        const b = cellVert(gx - 1, gy, gz);
        const c = cellVert(gx, gy, gz);
        const dd = cellVert(gx, gy, gz - 1);
        if (a < 0 || b < 0 || c < 0 || dd < 0) continue;

        if (d0 > 0) {
          indices[idxCount++] = a;
          indices[idxCount++] = b;
          indices[idxCount++] = c;
          indices[idxCount++] = a;
          indices[idxCount++] = c;
          indices[idxCount++] = dd;
        } else {
          indices[idxCount++] = a;
          indices[idxCount++] = dd;
          indices[idxCount++] = c;
          indices[idxCount++] = a;
          indices[idxCount++] = c;
          indices[idxCount++] = b;
        }
      }
    }
  }

  // Z-edges: from (gx, gy, gz) to (gx, gy, gz+1)
  for (let gz = 0; gz < meshDim; gz++) {
    for (let gy = 1; gy < meshDim; gy++) {
      for (let gx = 1; gx < meshDim; gx++) {
        const d0 = field[localVoxelToSampleIndex(gx, gy, gz)];
        const d1 = field[localVoxelToSampleIndex(gx, gy, gz + 1)];
        if (d0 > 0 === d1 > 0) continue;

        const a = cellVert(gx - 1, gy - 1, gz);
        const b = cellVert(gx, gy - 1, gz);
        const c = cellVert(gx, gy, gz);
        const dd = cellVert(gx - 1, gy, gz);
        if (a < 0 || b < 0 || c < 0 || dd < 0) continue;

        if (d0 > 0) {
          indices[idxCount++] = a;
          indices[idxCount++] = b;
          indices[idxCount++] = c;
          indices[idxCount++] = a;
          indices[idxCount++] = c;
          indices[idxCount++] = dd;
        } else {
          indices[idxCount++] = a;
          indices[idxCount++] = dd;
          indices[idxCount++] = c;
          indices[idxCount++] = a;
          indices[idxCount++] = c;
          indices[idxCount++] = b;
        }
      }
    }
  }

  const posArr = positions.slice(0, vertCount * 3);
  const normArr = normals.subarray(0, vertCount * 3);
  const idxArr = indices.subarray(0, idxCount);

  if (normalSmoothingIterations > 0 && idxCount > 0) {
    const adj = buildVertexAdjacency(vertCount, idxArr);
    smoothNormals(normArr, adj, vertCount, normalSmoothingIterations, boundaryFlags);
  }

  return {
    positions: posArr,
    normals: normArr.slice(),
    gradientMag,
    indices: idxArr.slice(),
    vertexCount: vertCount,
    indexCount: idxCount,
  };
}

function buildVertexAdjacency(vertCount: number, indices: Uint32Array): Uint32Array[] {
  const adj: Set<number>[] = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) adj[i] = new Set();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    adj[a].add(b);
    adj[a].add(c);
    adj[b].add(a);
    adj[b].add(c);
    adj[c].add(a);
    adj[c].add(b);
  }
  return adj.map((s) => new Uint32Array(s));
}

function smoothNormals(
  normals: Float32Array,
  adj: Uint32Array[],
  vertCount: number,
  iterations: number,
  boundary: Uint8Array
): void {
  const tmp = new Float32Array(vertCount * 3);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < vertCount; i++) {
      const i3 = i * 3;
      if (boundary[i]) {
        tmp[i3] = normals[i3];
        tmp[i3 + 1] = normals[i3 + 1];
        tmp[i3 + 2] = normals[i3 + 2];
        continue;
      }
      let sx = normals[i3];
      let sy = normals[i3 + 1];
      let sz = normals[i3 + 2];
      const neighbors = adj[i];
      for (let k = 0; k < neighbors.length; k++) {
        const n3 = neighbors[k] * 3;
        sx += normals[n3];
        sy += normals[n3 + 1];
        sz += normals[n3 + 2];
      }
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      const inv = len > 1e-8 ? 1 / len : 0;
      tmp[i3] = sx * inv;
      tmp[i3 + 1] = sy * inv;
      tmp[i3 + 2] = sz * inv;
    }
    for (let i = 0; i < vertCount * 3; i++) normals[i] = tmp[i];
  }
}
