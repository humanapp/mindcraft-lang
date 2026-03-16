import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { useEditorStore } from "@/editor/editor-store";
import { useSessionStore } from "@/session/session-store";
import { computeBrushPatches } from "@/world/terrain/edit";
import { useWorldStore } from "@/world/world-store";
import { GestureRouter } from "./GestureRouter";
import { DollyPanGesture } from "./gestures/DollyPanGesture";
import { OrbitGesture } from "./gestures/OrbitGesture";
import { SculptGesture } from "./gestures/SculptGesture";
import { InputManager } from "./InputManager";
import { SpaceSculptController } from "./SpaceSculptController";
import type { GestureHandler, PointerInput } from "./types";
import { WasdController } from "./WasdController";

/**
 * Constructs and wires the full input stack for the 3D viewport.
 *
 * Must be called from a component rendered inside a R3F Canvas so that
 * useFrame is available. R3F registers its own canvas event listeners during
 * Canvas mount, which happens before any useEffect runs, so R3F raycasting
 * always fires before InputManager's listeners — meaning sessionStore
 * hoverWorldPos is already current when InputManager reads it.
 */
export function useInputManager(camera: THREE.Camera, domElement: HTMLElement): void {
  const orbitRef = useRef<OrbitGesture | null>(null);
  const sculptRef = useRef<SculptGesture | null>(null);
  const wasdRef = useRef<WasdController | null>(null);
  const spaceRef = useRef<SpaceSculptController | null>(null);

  useEffect(() => {
    // reroute is a closure over `router`. It is only ever called during an active
    // drag, which requires the InputManager to already be set up — at which point
    // `router` is always assigned.
    let router: GestureRouter;
    const reroute = (input: PointerInput): GestureHandler | null => router.pick(input);

    const sculpt = new SculptGesture(
      {
        applyBrush: (worldPos, dt) => {
          const { brush, activeTool, addPendingPatches, setFlattenTarget } = useEditorStore.getState();
          const { chunks, applyFieldValues } = useWorldStore.getState();
          const clamp = useEditorStore.getState().clampDensity;
          const debug = useEditorStore.getState().debugBrush;
          let { flattenTarget } = useEditorStore.getState();
          if (activeTool === "flatten" && flattenTarget === null) {
            flattenTarget = worldPos[1];
            setFlattenTarget(flattenTarget);
          }
          const patches = computeBrushPatches(
            [worldPos[0], worldPos[1], worldPos[2]],
            brush,
            activeTool,
            chunks,
            dt,
            activeTool === "flatten" ? (flattenTarget ?? undefined) : undefined,
            debug
          );
          if (patches.length === 0) return;
          addPendingPatches(patches);
          applyFieldValues(
            patches.map((p) => ({ chunkId: p.chunkId, index: p.index, value: p.after })),
            clamp
          );
        },
        commitStroke: () => useEditorStore.getState().commitStroke(),
        setPointerDown: (down) => useSessionStore.getState().setPointerDown(down),
      },
      reroute
    );

    const orbit = new OrbitGesture(camera, reroute);
    const dollyPan = new DollyPanGesture(
      camera,
      () => orbit.getPivot(),
      (offset) => orbit.translatePivot(offset),
      reroute
    );

    orbitRef.current = orbit;
    sculptRef.current = sculpt;
    router = new GestureRouter(sculpt, orbit, dollyPan);

    const manager = new InputManager(domElement, router, () => useSessionStore.getState().hoverWorldPos, orbit);

    const wasd = new WasdController(camera, (offset) => orbit.translatePivot(offset));
    wasd.listen();
    wasdRef.current = wasd;

    const space = new SpaceSculptController(sculpt, () => useSessionStore.getState().hoverWorldPos);
    space.listen();
    spaceRef.current = space;

    return () => {
      manager.dispose();
      wasd.dispose();
      space.dispose();
      orbitRef.current = null;
      sculptRef.current = null;
      wasdRef.current = null;
      spaceRef.current = null;
    };
  }, [camera, domElement]);

  useFrame((_, delta) => {
    orbitRef.current?.update();
    sculptRef.current?.tick(delta);
    wasdRef.current?.update(delta);
    spaceRef.current?.update();
  }, -1);
}
