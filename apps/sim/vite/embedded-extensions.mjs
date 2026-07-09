import path from "path";
import { embeddedExtensionsVitePlugin } from "@mindcraft-lang/bridge-app/node";

// The extensions apps/sim offers, by coordinate and source directory. The file
// list of each comes from its own mindcraft.json, so adding a file to an
// extension needs no change here.
const registrations = [
  { coordinate: "mindcraft-lang/sim", dir: path.resolve(process.cwd(), "./lib") },
  { coordinate: "mindcraft-lang/core", dir: path.resolve(process.cwd(), "../../packages/core/lib") },
  {
    coordinate: "mindcraft-lang/ecosim-teleport-ext",
    dir: path.resolve(process.cwd(), "./extensions/ecosim-teleport-ext"),
  },
  {
    coordinate: "mindcraft-lang/ecosim-detect-ext",
    dir: path.resolve(process.cwd(), "./extensions/ecosim-detect-ext"),
  },
];

export function embeddedExtensions() {
  return embeddedExtensionsVitePlugin(registrations);
}
