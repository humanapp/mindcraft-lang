import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useEditorStore } from "../editor/editor-store";
import { useSessionStore } from "../session/session-store";
import { computeBrushPatches } from "../world/terrain/edit";
import { useWorldStore } from "../world/world-store";
import { BrushCursor } from "./BrushCursor";
import { TerrainChunkMesh } from "./TerrainChunkMesh";

function Terrain() {
  const chunkMeshes = useWorldStore((s) => s.chunkMeshes);
  const chunks = useWorldStore((s) => s.chunks);
  const applyFieldValues = useWorldStore((s) => s.applyFieldValues);
  const brush = useEditorStore((s) => s.brush);
  const activeTool = useEditorStore((s) => s.activeTool);
  const addPendingPatches = useEditorStore((s) => s.addPendingPatches);
  const commitStroke = useEditorStore((s) => s.commitStroke);
  const setHoverWorldPos = useSessionStore((s) => s.setHoverWorldPos);
  const setPointerDown = useSessionStore((s) => s.setPointerDown);
  const isPointerDownRef = useRef(false);

  const applyBrush = useCallback(
    (point: THREE.Vector3) => {
      const worldPos: [number, number, number] = [point.x, point.y, point.z];
      const patches = computeBrushPatches(worldPos, brush, activeTool === "raise", chunks);
      if (patches.length === 0) return;

      addPendingPatches(patches);
      applyFieldValues(patches.map((p) => ({ chunkId: p.chunkId, index: p.index, value: p.after })));
    },
    [brush, activeTool, chunks, addPendingPatches, applyFieldValues]
  );

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.shiftKey) return;
      e.stopPropagation();
      setPointerDown(true);
      isPointerDownRef.current = true;
      applyBrush(e.point);
    },
    [applyBrush, setPointerDown]
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.shiftKey) return;
      e.stopPropagation();
      setHoverWorldPos([e.point.x, e.point.y, e.point.z]);
      if (isPointerDownRef.current) {
        applyBrush(e.point);
      }
    },
    [applyBrush, setHoverWorldPos]
  );

  useEffect(() => {
    const handlePointerUp = () => {
      if (isPointerDownRef.current) {
        isPointerDownRef.current = false;
        setPointerDown(false);
        commitStroke();
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [commitStroke, setPointerDown]);

  const entries = Array.from(chunkMeshes.entries());

  return (
    <group>
      {entries.map(([id, data]) => (
        <TerrainChunkMesh
          key={id}
          chunkId={id}
          mesh={data.mesh}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
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

function CameraControls({ target }: { target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  useEffect(() => {
    const dom = gl.domElement;

    const controls = new OrbitControlsImpl(camera, dom);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enablePan = false;
    controls.enabled = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: -1 as THREE.MOUSE,
    };
    controls.target.set(target[0], target[1], target[2]);
    controlsRef.current = controls;

    const onPointerDown = (e: PointerEvent) => {
      if (e.shiftKey && e.button === 0) {
        controls.enabled = true;
      }
    };
    const onPointerUp = () => {
      controls.enabled = false;
    };

    dom.addEventListener("pointerdown", onPointerDown, true);
    dom.addEventListener("pointerup", onPointerUp, true);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown, true);
      dom.removeEventListener("pointerup", onPointerUp, true);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, target]);

  useFrame(() => {
    controlsRef.current?.update();
  }, -1);

  return null;
}

export function Scene() {
  const cameraTarget = useSessionStore((s) => s.cameraTarget);
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
      <CameraControls target={cameraTarget} />
      <gridHelper args={[256, 64, "#333344", "#222233"]} position={[64, -0.1, 64]} />
    </Canvas>
  );
}
