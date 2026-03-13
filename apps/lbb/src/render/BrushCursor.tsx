import { useRef } from "react";
import type { Mesh } from "three";
import { useSessionStore } from "../session/session-store";

interface BrushCursorProps {
  radius: number;
}

export function BrushCursor({ radius }: BrushCursorProps) {
  const meshRef = useRef<Mesh>(null);
  const hoverPos = useSessionStore((s) => s.hoverWorldPos);

  if (!hoverPos) return null;

  return (
    <mesh ref={meshRef} position={[hoverPos[0], hoverPos[1] + 0.1, hoverPos[2]]}>
      <sphereGeometry args={[radius, 16, 12]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.3} />
    </mesh>
  );
}
