import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback } from "react";
import { PCFSoftShadowMap } from "three";
import { useEditorStore } from "@/editor/editor-store";
import { useInputManager } from "@/input/useInputManager";
import { useSessionStore } from "@/session/session-store";
import { useWorldStore } from "@/world/world-store";
import { BrushCursor } from "./BrushCursor";
import { VoxelSamplesOverlay } from "./debug/VoxelSamplesOverlay";
import { TerrainChunkMesh } from "./TerrainChunkMesh";

function Terrain() {
  const chunkMeshes = useWorldStore((s) => s.chunkMeshes);
  const setHoverWorldPos = useSessionStore((s) => s.setHoverWorldPos);
  const wireframe = useEditorStore((s) => s.wireframe);
  const terrainShading = useEditorStore((s) => s.terrainShading);
  const entries = Array.from(chunkMeshes.entries());

  const handlePointerEvent = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
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
          shadingMode={terrainShading}
          onPointerDown={handlePointerEvent}
          onPointerMove={handlePointerEvent}
        />
      ))}
    </group>
  );
}

const MESH_BUDGET_PER_FRAME = 4;
const COLLIDER_BUDGET_PER_FRAME = 2;

function TerrainUpdater() {
  const remeshDirtyChunks = useWorldStore((s) => s.remeshDirtyChunks);
  const flushStaleColliders = useWorldStore((s) => s.flushStaleColliders);
  useFrame(() => {
    remeshDirtyChunks(MESH_BUDGET_PER_FRAME);
    flushStaleColliders(COLLIDER_BUDGET_PER_FRAME);
  }, -10);
  return null;
}

function Lighting() {
  return (
    <>
      <hemisphereLight args={["#b1c8e0", "#3a3020", 0.6]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[160, 180, 120]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
        shadow-camera-near={1}
        shadow-camera-far={600}
        shadow-bias={-0.0005}
        shadow-normalBias={0.3}
      />
      <directionalLight position={[-80, 100, -60]} intensity={0.2} />
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
  const brushShape = useEditorStore((s) => s.brush.shape);

  return (
    <Canvas
      shadows={{ type: PCFSoftShadowMap }}
      camera={{ position: [160, 50, 160], fov: 55, near: 0.5, far: 1500 }}
      style={{ width: "100%", height: "100%" }}
      onPointerMissed={() => {
        useSessionStore.getState().setHoverWorldPos(null);
      }}
    >
      <color attach="background" args={["#1a1a2e"]} />
      <fog attach="fog" args={["#1a1a2e", 250, 500]} />
      <Lighting />
      <Terrain />
      <TerrainUpdater />
      <BrushCursor radius={brushRadius} shape={brushShape} />
      <InputHandler />
      <VoxelSamplesOverlay />
    </Canvas>
  );
}
