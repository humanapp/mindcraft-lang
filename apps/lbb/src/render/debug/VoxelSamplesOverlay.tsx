import { useEditorStore } from "../../editor/editor-store";
import { useWorldStore } from "../../world/world-store";
import { ChunkDensitySign } from "./ChunkDensitySign";
import { ChunkDebugPoints } from "./ChunkSamplePoints";

export function VoxelSamplesOverlay() {
  const mode = useEditorStore((s) => s.voxelDebugMode);
  const chunkMeshes = useWorldStore((s) => s.chunkMeshes);
  const chunks = useWorldStore((s) => s.chunks);

  if (mode === "off") return null;

  return (
    <>
      {Array.from(chunkMeshes.entries()).map(([id, renderData]) => {
        const chunk = chunks.get(id);
        if (!chunk) return null;
        if (mode === "density-sign") {
          return <ChunkDensitySign key={id} chunk={chunk} />;
        }
        return <ChunkDebugPoints key={id} chunk={chunk} meshPositions={renderData.mesh.positions} mode={mode} />;
      })}
    </>
  );
}
