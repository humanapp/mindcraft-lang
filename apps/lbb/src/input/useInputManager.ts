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
import { PlanePanGesture } from "./gestures/PlanePanGesture";
import { PlaneRotateGesture } from "./gestures/PlaneRotateGesture";
import { SculptGesture } from "./gestures/SculptGesture";
import { InputManager } from "./InputManager";
import type { GestureHandler, PointerInput } from "./types";
import { WasdController } from "./WasdController";
import { WorkingPlaneController } from "./WorkingPlaneController";

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
  const planeCtrlRef = useRef<WorkingPlaneController | null>(null);

  useEffect(() => {
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
            patches.map((p) => ({ chunkId: p.chunkId, fieldIndex: p.fieldIndex, value: p.after })),
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

    const { workingPlane, bumpWorkingPlaneVersion } = useEditorStore.getState();

    const planePan = new PlanePanGesture(camera, workingPlane, bumpWorkingPlaneVersion, reroute);
    const planeRotate = new PlaneRotateGesture(camera, workingPlane, bumpWorkingPlaneVersion, reroute);

    const manager = new InputManager(domElement, router, () => useSessionStore.getState().hoverWorldPos, orbit);

    const wasd = new WasdController(camera, (offset) => orbit.translatePivot(offset));
    wasd.listen();
    wasdRef.current = wasd;

    const planeCtrl = new WorkingPlaneController(camera, workingPlane, bumpWorkingPlaneVersion);
    planeCtrl.listen();
    planeCtrlRef.current = planeCtrl;

    router.setPlaneGestures(planeRotate, planePan, () => planeCtrl.spaceHeld);

    return () => {
      manager.dispose();
      wasd.dispose();
      planeCtrl.dispose();
      orbitRef.current = null;
      sculptRef.current = null;
      wasdRef.current = null;
      planeCtrlRef.current = null;
    };
  }, [camera, domElement]);

  useFrame((_, delta) => {
    const planeCtrl = planeCtrlRef.current;

    orbitRef.current?.update();
    sculptRef.current?.tick(delta);

    if (planeCtrl?.spaceHeld) {
      planeCtrl.update(delta);
    } else {
      wasdRef.current?.update(delta);
    }
  }, -1);
}
