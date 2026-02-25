import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Scene } from "./Scene";

function App() {
  return (
    <div id="canvas-container">
      <h1>Silly Walk Simulator</h1>
      <Canvas shadows camera={{ position: [5, 5, 5], fov: 50 }}>
        <Physics gravity={[0, -9.81, 0]}>
          <Scene />
        </Physics>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}

export default App;
