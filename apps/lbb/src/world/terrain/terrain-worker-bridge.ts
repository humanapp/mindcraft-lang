import type { MesherOptions } from "@/world/voxel/mesher";
import type { ChunkCoord, MeshData } from "@/world/voxel/types";
import type { WorkerRequest, WorkerResponse } from "./worker-types";

interface PendingJob<T> {
  resolve: (value: T) => void;
}

interface MeshResult {
  chunkId: string;
  mesh: MeshData;
}

interface GenerateResult {
  chunkId: string;
  coord: ChunkCoord;
  field: Float32Array;
}

const POOL_SIZE = Math.min(navigator.hardwareConcurrency ?? 4, 4);

export class TerrainWorkerBridge {
  private workers: Worker[] = [];
  private nextWorker = 0;
  private nextId = 0;
  private pendingMesh = new Map<number, PendingJob<MeshResult>>();
  private pendingGenerate = new Map<number, PendingJob<GenerateResult>>();

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleResponse(e.data);
      w.onerror = (e) => {
        console.error(`[terrain-worker] worker ${i} error:`, e.message);
      };
      this.workers.push(w);
    }
  }

  requestMesh(chunkId: string, coord: ChunkCoord, field: Float32Array, options: MesherOptions): Promise<MeshResult> {
    const id = this.nextId++;
    const fieldCopy = new Float32Array(field);
    const msg: WorkerRequest = { type: "mesh", id, chunkId, coord, field: fieldCopy, options };
    return new Promise<MeshResult>((resolve) => {
      this.pendingMesh.set(id, { resolve });
      const w = this.workers[this.nextWorker % this.workers.length];
      this.nextWorker++;
      w.postMessage(msg, [fieldCopy.buffer]);
    });
  }

  requestGenerate(chunkId: string, coord: ChunkCoord): Promise<GenerateResult> {
    const id = this.nextId++;
    const msg: WorkerRequest = { type: "generate", id, chunkId, coord };
    return new Promise<GenerateResult>((resolve) => {
      this.pendingGenerate.set(id, { resolve });
      const w = this.workers[this.nextWorker % this.workers.length];
      this.nextWorker++;
      w.postMessage(msg);
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }

  private handleResponse(msg: WorkerResponse): void {
    if (msg.type === "mesh") {
      const job = this.pendingMesh.get(msg.id);
      if (job) {
        this.pendingMesh.delete(msg.id);
        job.resolve({ chunkId: msg.chunkId, mesh: msg.mesh });
      }
      return;
    }

    if (msg.type === "generate") {
      const job = this.pendingGenerate.get(msg.id);
      if (job) {
        this.pendingGenerate.delete(msg.id);
        job.resolve({ chunkId: msg.chunkId, coord: msg.coord, field: msg.field });
      }
    }
  }
}
