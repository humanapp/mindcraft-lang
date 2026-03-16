export const CHUNK_SIZE = 32;
export const FIELD_PAD = 2;
export const SAMPLES = CHUNK_SIZE + 2 + 2 * FIELD_PAD;
export const SAMPLES_SQ = SAMPLES * SAMPLES;
export const SAMPLES_TOTAL = SAMPLES * SAMPLES * SAMPLES;
export const CORE_SAMPLES = CHUNK_SIZE + 1;

export interface ChunkCoord {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
}

export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly gradientMag: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly indexCount: number;
}

export interface ChunkData {
  readonly coord: ChunkCoord;
  readonly field: Float32Array;
  version: number;
}

export function chunkId(coord: ChunkCoord): string {
  return `${coord.cx},${coord.cy},${coord.cz}`;
}

export function chunkWorldOrigin(coord: ChunkCoord): [number, number, number] {
  return [coord.cx * CHUNK_SIZE, coord.cy * CHUNK_SIZE, coord.cz * CHUNK_SIZE];
}

export function sampleIndex(sx: number, sy: number, sz: number): number {
  return sx + sy * SAMPLES + sz * SAMPLES_SQ;
}

export function localVoxelToSampleIndex(lx: number, ly: number, lz: number): number {
  return sampleIndex(lx + FIELD_PAD, ly + FIELD_PAD, lz + FIELD_PAD);
}

export function worldToChunkCoord(wx: number, wy: number, wz: number): ChunkCoord {
  return {
    cx: Math.floor(wx / CHUNK_SIZE),
    cy: Math.floor(wy / CHUNK_SIZE),
    cz: Math.floor(wz / CHUNK_SIZE),
  };
}

export function worldToLocalVoxel(wx: number, wy: number, wz: number): [number, number, number] {
  return [
    wx - Math.floor(wx / CHUNK_SIZE) * CHUNK_SIZE,
    wy - Math.floor(wy / CHUNK_SIZE) * CHUNK_SIZE,
    wz - Math.floor(wz / CHUNK_SIZE) * CHUNK_SIZE,
  ];
}
