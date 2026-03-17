import { useRef } from "react";
import type { Mesh } from "three";
import { useEditorStore } from "@/editor/editor-store";
import { useSessionStore } from "@/session/session-store";
import type { BrushShape } from "@/world/terrain/edit";

interface BrushCursorProps {
  radius: number;
  shape: BrushShape;
}

function BrushGeometry({ radius, shape }: { radius: number; shape: BrushShape }) {
  switch (shape) {
    case "sphere":
      return <sphereGeometry args={[radius, 16, 12]} />;
    case "cube":
      return <boxGeometry args={[radius * 2, radius * 2, radius * 2]} />;
    case "cylinder":
      return <cylinderGeometry args={[radius, radius, radius * 2, 16]} />;
  }
}

export function BrushCursor({ radius, shape }: BrushCursorProps) {
  const meshRef = useRef<Mesh>(null);
  const hoverPos = useSessionStore((s) => s.hoverWorldPos);
  const spaceHeld = useEditorStore((s) => s.spaceHeld);

  if (!hoverPos || spaceHeld) return null;

  return (
    <mesh ref={meshRef} position={[hoverPos[0], hoverPos[1] + 0.1, hoverPos[2]]}>
      <BrushGeometry radius={radius} shape={shape} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.3} />
    </mesh>
  );
}
