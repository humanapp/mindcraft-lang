import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";
import path from "path";
import { uiPlugin } from "../../../packages/ui/src/vite-plugin.ts";

const appRoot = path.resolve(__dirname, "..");
const assetsRoot = path.resolve(appRoot, "assets") + path.sep;

const allowPkg =
  path.resolve(appRoot, "node_modules/@mindcraft-lang/core/dist/esm") + path.sep;

export default defineConfig({
  base: "/",
  appType: "spa",
  plugins: [
    glsl(),
    react(),
    uiPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
      "@mindcraft-lang/docs": path.resolve(process.cwd(), "../../packages/docs/src"),
      "@mindcraft-lang/ui": path.resolve(process.cwd(), "../../packages/ui/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@mindcraft-lang/core"],
  },
  server: {
    fs: {
      allow: [
        path.resolve(process.cwd(), "../..")
      ],
    },
    watch: {
      ignored: (p) => {
        const ap = path.resolve(p);

        if (ap.startsWith(allowPkg)) {
          return false;
        }

        if (ap.startsWith(assetsRoot)) {
          return true;
        }

        if (ap.includes(`${path.sep}node_modules${path.sep}`)) {
          return true;
        }

        return false;
      },
    },
    port: 8081,
  },
});
