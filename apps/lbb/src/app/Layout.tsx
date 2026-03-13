import { Scene } from "../render/Scene";
import { InspectorPanel } from "./InspectorPanel";
import { Toolbar } from "./Toolbar";

export function Layout() {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Scene />
      <Toolbar />
      <InspectorPanel />
    </div>
  );
}
