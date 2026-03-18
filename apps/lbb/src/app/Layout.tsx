import { Scene } from "@/render/Scene";
import { Toolbar } from "./Toolbar";

export function Layout() {
  return (
    <div className="relative w-full h-full">
      <Scene />
      <Toolbar />
    </div>
  );
}
