import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { uiPlugin } from "../../../packages/ui/src/vite-plugin.ts";

const appRoot = path.resolve(__dirname, ".."); // adjust if needed
const assetsRoot = path.resolve(appRoot, "assets") + path.sep;

const allowPkg =
  path.resolve(appRoot, "node_modules/@mindcraft-lang/core/dist/esm") + path.sep;

function vfsServiceWorkerPlugin() {
  return {
    name: "vfs-sw-allowed",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Service-Worker-Allowed", "/");
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base: "/",
  appType: "spa",
  plugins: [
    vfsServiceWorkerPlugin(),
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
    exclude: ["@mindcraft-lang/core", "@mindcraft-lang/bridge-app"],
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

        // 1) explicitly allow this package (must come first)
        if (ap.startsWith(allowPkg)) {
          return false;
        }

        // 2) ignore root-level assets
        if (ap.startsWith(assetsRoot)) {
          return true;
        }

        // 3) ignore all other node_modules
        if (ap.includes(`${path.sep}node_modules${path.sep}`)) {
          return true;
        }

        // 4) watch everything else
        return false;
      },
    },
    port: 8080,
  },
});

