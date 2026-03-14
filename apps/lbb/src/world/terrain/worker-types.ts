import type { MesherOptions } from "./mesher";
import type { ChunkCoord, MeshData } from "./types";

export interface MeshRequest {
  readonly type: "mesh";
  readonly id: number;
  readonly chunkId: string;
  readonly coord: ChunkCoord;
  readonly field: Float32Array;
  readonly options: MesherOptions;
}

export interface MeshResponse {
  readonly type: "mesh";
  readonly id: number;
  readonly chunkId: string;
  readonly mesh: MeshData;
}

export interface GenerateRequest {
  readonly type: "generate";
  readonly id: number;
  readonly chunkId: string;
  readonly coord: ChunkCoord;
}

export interface GenerateResponse {
  readonly type: "generate";
  readonly id: number;
  readonly chunkId: string;
  readonly coord: ChunkCoord;
  readonly field: Float32Array;
}

export type WorkerRequest = MeshRequest | GenerateRequest;
export type WorkerResponse = MeshResponse | GenerateResponse;
