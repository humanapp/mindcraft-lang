import { RigidBody } from "@react-three/rapier";
import { DraggableBody } from "@/components/DraggableBody";
import { CharacterRig } from "./components/CharacterRig";

/**
 * A minimal Three.js scene with Rapier physics.
 * The ground is a fixed rigid body; the box is dynamic and falls under gravity.
 */
export function Scene() {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 8, 3]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Ground plane -- fixed rigid body so objects rest on it */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <boxGeometry args={[20, 20, 0.2]} />
          <meshStandardMaterial color="#4a7c59" />
        </mesh>
      </RigidBody>
      <CharacterRig />
    </>
  );
}
