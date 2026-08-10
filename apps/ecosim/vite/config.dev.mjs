import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { uiPlugin } from "../../../packages/ui/src/vite-plugin.ts";
import { rehearsalDefines } from "../src/rehearsal/source-content.ts";
import { embeddedExtensions } from "./embedded-extensions.mjs";

const appRoot = path.resolve(__dirname, ".."); // adjust if needed
const assetsRoot = path.resolve(appRoot, "assets") + path.sep;

// https://vitejs.dev/config/
export default defineConfig({
  base: "/",
  appType: "spa",
  plugins: [react(), uiPlugin(), embeddedExtensions()],
  define: rehearsalDefines(),
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
      "@mindcraft-lang/assistant-panel": path.resolve(process.cwd(), "../../packages/assistant-panel/src"),
      "@mindcraft-lang/docs": path.resolve(process.cwd(), "../../packages/docs/src"),
      "@mindcraft-lang/ui": path.resolve(process.cwd(), "../../packages/ui/src"),
      "@mindcraft-lang/app-host": path.resolve(process.cwd(), "../../packages/app-host/src"),
      "@mindcraft-lang/ts-compiler": path.resolve(process.cwd(), "../../packages/ts-compiler/src"),
      "@mindcraft-lang/bridge-protocol": path.resolve(process.cwd(), "../../packages/bridge-protocol/src"),
      "@mindcraft-lang/bridge-client": path.resolve(process.cwd(), "../../packages/bridge-client/src"),
      "@mindcraft-lang/bridge-app": path.resolve(process.cwd(), "../../packages/bridge-app/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@mindcraft-lang/core", "zod"],
  },
  server: {
    fs: {
      allow: [path.resolve(process.cwd(), "../..")],
    },
    watch: {
      ignored: (p) => {
        const ap = path.resolve(p);

        // Ignore root-level assets.
        if (ap.startsWith(assetsRoot)) {
          return true;
        }

        // Ignore node_modules.
        if (ap.includes(`${path.sep}node_modules${path.sep}`)) {
          return true;
        }

        // Watch everything else.
        return false;
      },
    },
    port: 8080,
  },
});
