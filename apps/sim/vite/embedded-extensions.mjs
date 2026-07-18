import path from "path";
import { embeddedExtensionsVitePlugin } from "@mindcraft-lang/bridge-app/node";

// The extensions apps/sim offers, by coordinate and source directory. The file
// list of each comes from its own mindcraft.json, so adding a file to an
// extension needs no change here.
const registrations = [
  { coordinate: "mindcraft-lang/sim", dir: path.resolve(process.cwd(), "./lib") },
  { coordinate: "mindcraft-lang/lib-core", dir: path.resolve(process.cwd(), "../../packages/core/lib") },
  {
    coordinate: "mindcraft-lang/lib-ecosim-teleport",
    dir: path.resolve(process.cwd(), "./extensions/lib-ecosim-teleport"),
  },
  {
    coordinate: "mindcraft-lang/lib-ecosim-detect",
    dir: path.resolve(process.cwd(), "./extensions/lib-ecosim-detect"),
  },
];

export function embeddedExtensions() {
  return embeddedExtensionsVitePlugin(registrations);
}
