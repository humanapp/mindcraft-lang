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
      <ambientLight intensity={0.5} />
      {/* Key light -- warm sun from upper-right-front */}
      <directionalLight
        position={[5, 10, 5]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-bias={-0.001}
        color="#fff5e6"
      />
      {/* Fill light -- cool blue from the opposite side to soften shadows */}
      <directionalLight position={[-4, 6, -3]} intensity={0.35} color="#b0c4ff" />
      {/* Rim / back light -- subtle highlight on edges */}
      <directionalLight position={[0, 4, -6]} intensity={0.25} color="#ffffff" />
      {/* Ground bounce -- faint upward light to lift the underside */}
      <hemisphereLight args={["#b0d0ff", "#3a5f2a", 0.3]} />

      {/* Ground plane -- fixed rigid body so objects rest on it.
          The box is 0.2m thick along Y after rotation. Position the mesh
          at y=-0.1 so the top surface sits at y=0 (matching the headless
          harness ground). friction=1 matches the rig foot colliders. */}
      <RigidBody type="fixed" colliders="cuboid" friction={1} restitution={0}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
          <boxGeometry args={[20, 20, 0.2]} />
          <meshStandardMaterial color="#ddeeff" />
        </mesh>
      </RigidBody>
      <CharacterRig />
    </>
  );
}
