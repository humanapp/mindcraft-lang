import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const appRoot = path.resolve(__dirname, ".."); // adjust if needed
const assetsRoot = path.resolve(appRoot, "assets") + path.sep;

const allowPkg =
  path.resolve(appRoot, "node_modules/@mindcraft-lang/core/dist/esm") + path.sep;

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
      // Remove direct alias to let package.json exports handle resolution
      // "@mindcraft-lang/core": path.resolve(process.cwd(), "../../packages/core"),
    },
  },
  optimizeDeps: {
    exclude: ["@mindcraft-lang/core"],
  },
  server: {
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

