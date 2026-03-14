import { generateChunkField } from "./generator";
import { extractSurfaceNets } from "./mesher";
import type { WorkerRequest, WorkerResponse } from "./worker-types";

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "mesh") {
    const mesh = extractSurfaceNets(msg.field, msg.coord, msg.options);
    const response: WorkerResponse = {
      type: "mesh",
      id: msg.id,
      chunkId: msg.chunkId,
      mesh,
    };
    self.postMessage(response, [
      mesh.positions.buffer,
      mesh.normals.buffer,
      mesh.gradientMag.buffer,
      mesh.indices.buffer,
    ] as never);
    return;
  }

  if (msg.type === "generate") {
    const field = generateChunkField(msg.coord);
    const response: WorkerResponse = {
      type: "generate",
      id: msg.id,
      chunkId: msg.chunkId,
      coord: msg.coord,
      field,
    };
    self.postMessage(response, [field.buffer] as never);
  }
};
