import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import commonjs from "@rollup/plugin-commonjs";
import path from "path";
import { uiPlugin } from "../../../packages/ui/src/vite-plugin.ts";

export default defineConfig({
  base: "/",
  plugins: [
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
  ssr: {
    noExternal: ["@mindcraft-lang/core"],
  },
  logLevel: "warning",
  build: {
    rollupOptions: {
      external: [],
      plugins: [
        commonjs({
          include: [/packages\/core/],
        }),
      ],
      output: {
        manualChunks: {
          three: ["three"],
          r3f: ["@react-three/fiber", "@react-three/drei"],
          rapier: ["@dimforge/rapier3d-compat"],
        },
      },
    },
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false },
    },
  },
});
