import commonjs from "@rollup/plugin-commonjs";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { uiPlugin } from "../../../packages/ui/src/vite-plugin.ts";
import { rehearsalDefines } from "../src/rehearsal/source-content.ts";
import { embeddedExtensions } from "./embedded-extensions.mjs";
import { sitemapPlugin } from "./sitemap-plugin.mjs";

const phasermsg = () => {
  return {
    name: "phasermsg",
    buildStart() {
      process.stdout.write(`Building for production...\n`);
    },
    buildEnd() {
      process.stdout.write(` Done \n`);
    },
  };
};

export default defineConfig({
  base: "/",
  plugins: [react(), uiPlugin(), sitemapPlugin(), phasermsg(), embeddedExtensions()],
  define: rehearsalDefines(),
  resolve: {
    dedupe: ["sonner"],
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
      "@wendoo-lang/assistant-panel": path.resolve(process.cwd(), "../../packages/assistant-panel/src"),
      "@wendoo-lang/docs": path.resolve(process.cwd(), "../../packages/docs/src"),
      "@wendoo-lang/ui": path.resolve(process.cwd(), "../../packages/ui/src"),
      "@wendoo-lang/app-host": path.resolve(process.cwd(), "../../packages/app-host/src"),
      "@wendoo-lang/ts-compiler": path.resolve(process.cwd(), "../../packages/ts-compiler/src"),
      "@wendoo-lang/bridge-protocol": path.resolve(process.cwd(), "../../packages/bridge-protocol/src"),
      "@wendoo-lang/bridge-client": path.resolve(process.cwd(), "../../packages/bridge-client/src"),
      "@wendoo-lang/bridge-app": path.resolve(process.cwd(), "../../packages/bridge-app/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@wendoo-lang/core"],
  },
  ssr: {
    noExternal: ["@wendoo-lang/core"],
  },
  logLevel: "warning",
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(process.cwd(), "index.html"),
      },
      external: [],
      plugins: [
        commonjs({
          include: [/packages\/core/],
        }),
      ],
      output: {
        manualChunks: {
          phaser: ["phaser"],
        },
      },
    },
    minify: "terser",
    terserOptions: {
      compress: {
        passes: 2,
      },
      mangle: true,
      format: {
        comments: false,
      },
    },
  },
});
