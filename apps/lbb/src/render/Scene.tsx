import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback } from "react";
import { useEditorStore } from "../editor/editor-store";
import { useInputManager } from "../input/useInputManager";
import { useSessionStore } from "../session/session-store";
import { useWorldStore } from "../world/world-store";
import { BrushCursor } from "./BrushCursor";
import { TerrainChunkMesh } from "./TerrainChunkMesh";

function Terrain() {
  const chunkMeshes = useWorldStore((s) => s.chunkMeshes);
  const setHoverWorldPos = useSessionStore((s) => s.setHoverWorldPos);
  const wireframe = useEditorStore((s) => s.wireframe);
  const entries = Array.from(chunkMeshes.entries());

  const handlePointerEvent = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      setHoverWorldPos([e.point.x, e.point.y, e.point.z]);
    },
    [setHoverWorldPos]
  );

  return (
    <group>
      {entries.map(([id, data]) => (
        <TerrainChunkMesh
          key={id}
          chunkId={id}
          mesh={data.mesh}
          wireframe={wireframe}
          onPointerDown={handlePointerEvent}
          onPointerMove={handlePointerEvent}
        />
      ))}
    </group>
  );
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[80, 100, 60]} intensity={0.8} castShadow={false} />
      <directionalLight position={[-40, 60, -30]} intensity={0.3} />
    </>
  );
}

function InputHandler() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useInputManager(camera, gl.domElement);
  return null;
}

export function Scene() {
  const brushRadius = useEditorStore((s) => s.brush.radius);

  return (
    <Canvas
      camera={{ position: [80, 50, 80], fov: 55, near: 0.5, far: 1000 }}
      style={{ width: "100%", height: "100%" }}
      onPointerMissed={() => {
        useSessionStore.getState().setHoverWorldPos(null);
      }}
    >
      <color attach="background" args={["#1a1a2e"]} />
      <fog attach="fog" args={["#1a1a2e", 150, 300]} />
      <Lighting />
      <Terrain />
      <BrushCursor radius={brushRadius} />
      <InputHandler />
      <gridHelper args={[256, 64, "#333344", "#222233"]} position={[64, -0.1, 64]} />
    </Canvas>
  );
}
