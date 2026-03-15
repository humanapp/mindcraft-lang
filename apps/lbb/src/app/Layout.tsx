import { Scene } from "../render/Scene";
import { InspectorPanel } from "./InspectorPanel";
import { Toolbar } from "./Toolbar";

export function Layout() {
  return (
    <div className="relative w-full h-full">
      <Scene />
      <Toolbar />
      <InspectorPanel />
    </div>
  );
}
