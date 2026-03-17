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
import { GradientSkybox } from "./sky/GradientSkybox";
import { SKY_GRADIENTS } from "./sky/gradientSkyboxUtils";
import { TerrainChunkMesh } from "./TerrainChunkMesh";
import { BrushTargetResolver } from "./WorkingPlaneHitTester";
import { WorkingPlaneVisual } from "./WorkingPlaneVisual";

function Terrain() {
  const chunkRenderData = useWorldStore((s) => s.chunkRenderData);
  const setTerrainHit = useSessionStore((s) => s.setTerrainHit);
  const wireframe = useEditorStore((s) => s.wireframe);
  const terrainShading = useEditorStore((s) => s.terrainShading);
  const entries = Array.from(chunkRenderData.entries());

  const handlePointerEvent = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setTerrainHit([e.point.x, e.point.y, e.point.z], e.distance);
    },
    [setTerrainHit]
  );

  const handlePointerLeave = useCallback(() => {
    setTerrainHit(null, Number.POSITIVE_INFINITY);
  }, [setTerrainHit]);

  return (
    <group onPointerLeave={handlePointerLeave}>
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
  const normalSmoothing = useEditorStore((s) => s.normalSmoothing);
  useFrame(() => {
    remeshDirtyChunks(MESH_BUDGET_PER_FRAME, { normalSmoothingIterations: normalSmoothing });
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
  const skyGradient = useEditorStore((s) => s.skyGradient);

  return (
    <Canvas
      shadows={{ type: PCFSoftShadowMap }}
      camera={{ position: [160, 50, 160], fov: 55, near: 0.5, far: 1500 }}
      style={{ width: "100%", height: "100%" }}
      onPointerMissed={() => {
        useSessionStore.getState().setTerrainHit(null, Number.POSITIVE_INFINITY);
      }}
    >
      <GradientSkybox gradientStops={SKY_GRADIENTS[skyGradient]} fog={{ near: 150, far: 350 }} />
      <Lighting />
      <Terrain />
      <TerrainUpdater />
      <BrushCursor radius={brushRadius} shape={brushShape} />
      <WorkingPlaneVisual />
      <BrushTargetResolver />
      <InputHandler />
      <VoxelSamplesOverlay />
    </Canvas>
  );
}
