import {
  assertDependencyDistsFresh,
  readTargetIdentity,
  readTileDocContent,
} from "@mindcraft-lang/assistant-bridge/kit";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { defineConfig } from "vite";

const appDir = process.cwd();

assertDependencyDistsFresh(appDir);

// Target identity injected into the headless artifact as TARGET_IDENTITY.
const targetIdentity = readTargetIdentity(appDir);

// The app's own assets, injected so the artifact carries them and resolves
// nothing from the tree that built it: the tile documentation, and the brain
// document shipped for each archetype.
const tileDocContent = readTileDocContent(path.resolve(appDir, "src/docs/content/en/tiles"));
const brainDefsDir = path.resolve(appDir, "public/assets/brain/defs");
const shippedBrainDefs = Object.fromEntries(
  readdirSync(brainDefsDir)
    .filter((file) => file.startsWith("default-") && file.endsWith(".brain"))
    .map((file) => [
      file.slice("default-".length, -".brain".length),
      readFileSync(path.join(brainDefsDir, file)).toString("base64"),
    ])
);

// Build output of packages linked into the app from this repository, which sits
// outside node_modules.
const linkedPackages = /[\\/]dist[\\/]node[\\/]/;

// Builds the headless target adapter: one self-contained,
// plain-Node-importable ES module that runs the world without a renderer.
// Everything it needs is inside it, so it loads and rehearses from wherever it
// is copied to.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(appDir, "./src"),
      "@mindcraft-lang/docs": path.resolve(appDir, "../../packages/docs/src"),
      "@mindcraft-lang/ui": path.resolve(appDir, "../../packages/ui/src"),
    },
  },
  ssr: {
    noExternal: true,
  },
  define: {
    TARGET_IDENTITY: JSON.stringify(targetIdentity),
    TILE_DOC_CONTENT: JSON.stringify(tileDocContent),
    SHIPPED_BRAIN_DEFS: JSON.stringify(shippedBrainDefs),
  },
  publicDir: false,
  logLevel: "warn",
  build: {
    ssr: path.resolve(appDir, "src/rehearsal/adapter.ts"),
    outDir: "dist-headless",
    emptyOutDir: true,
    minify: false,
    commonjsOptions: {
      include: [/node_modules/, linkedPackages],
    },
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "rehearsal/adapter.js",
      },
    },
  },
});
