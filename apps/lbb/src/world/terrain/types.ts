export const CHUNK_SIZE = 32;
// +1 because N cells require N+1 sample points per axis, and another +1
// so each chunk overlaps its positive neighbor by one cell, allowing the
// mesher to emit boundary quads without cross-chunk lookups.
export const SAMPLES = CHUNK_SIZE + 2;
export const SAMPLES_SQ = SAMPLES * SAMPLES;
export const SAMPLES_TOTAL = SAMPLES * SAMPLES * SAMPLES;

export interface ChunkCoord {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
}

export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
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

export function sampleIndex(lx: number, ly: number, lz: number): number {
  return lx + ly * SAMPLES + lz * SAMPLES_SQ;
}
