import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEditorStore } from "@/editor/editor-store";
import { useSessionStore } from "@/session/session-store";

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

export function BrushTargetResolver() {
  const camera = useThree((s) => s.camera);
  const pointer = useThree((s) => s.pointer);

  useFrame(() => {
    const { workingPlaneEnabled, workingPlane, spaceHeld } = useEditorStore.getState();
    const session = useSessionStore.getState();
    const { terrainHitPos, terrainHitDistance } = session;

    if (!workingPlaneEnabled || spaceHeld) {
      session.setHoverWithSource(terrainHitPos, terrainHitPos ? "terrain" : null);
      return;
    }

    _ndc.set(pointer.x, pointer.y);
    _raycaster.setFromCamera(_ndc, camera);

    const planeHit = workingPlane.raycast(_raycaster.ray.origin, _raycaster.ray.direction);
    const hasPlaneHit = planeHit !== null && planeHit.distance > 0;

    if (hasPlaneHit) {
      session.setHoverWithSource([planeHit.position.x, planeHit.position.y, planeHit.position.z], "working-plane");
    } else {
      session.setHoverWithSource(null, null);
    }
  }, 0);

  return null;
}
