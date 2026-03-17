import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useEditorStore } from "@/editor/editor-store";

const PLANE_SIZE = 80;
const GRID_DIVISIONS = 40;

const NORMAL_OPACITY = 0.08;
const NORMAL_GRID_OPACITY = 0.2;
const ACTIVE_OPACITY = 0.15;
const ACTIVE_GRID_OPACITY = 0.5;

const PLANE_COLOR = new THREE.Color(0x4488ff);
const ACTIVE_PLANE_COLOR = new THREE.Color(0x66aaff);

function GridLineMaterial({ opacity, color }: { opacity: number; color: THREE.Color }) {
  return <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} depthTest />;
}

function PlaneGrid({
  size,
  divisions,
  opacity,
  color,
}: {
  size: number;
  divisions: number;
  opacity: number;
  color: THREE.Color;
}) {
  const geometry = useMemo(() => {
    const half = size / 2;
    const step = size / divisions;
    const positions: number[] = [];
    for (let i = 0; i <= divisions; i++) {
      const t = -half + i * step;
      positions.push(t, 0, -half, t, 0, half);
      positions.push(-half, 0, t, half, 0, t);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [size, divisions]);

  return (
    <lineSegments geometry={geometry}>
      <GridLineMaterial opacity={opacity} color={color} />
    </lineSegments>
  );
}

export function WorkingPlaneVisual() {
  const enabled = useEditorStore((s) => s.workingPlaneEnabled);
  const plane = useEditorStore((s) => s.workingPlane);
  const spaceHeld = useEditorStore((s) => s.spaceHeld);
  const version = useEditorStore((s) => s.workingPlaneVersion);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    g.position.copy(plane.position);
    g.quaternion.copy(plane.quaternion);
  });

  if (!enabled) return null;

  const fillOpacity = spaceHeld ? ACTIVE_OPACITY : NORMAL_OPACITY;
  const gridOpacity = spaceHeld ? ACTIVE_GRID_OPACITY : NORMAL_GRID_OPACITY;
  const color = spaceHeld ? ACTIVE_PLANE_COLOR : PLANE_COLOR;

  return (
    <group ref={groupRef} renderOrder={1}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={fillOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest
        />
      </mesh>
      <PlaneGrid size={PLANE_SIZE} divisions={GRID_DIVISIONS} opacity={gridOpacity} color={color} />
    </group>
  );
}
