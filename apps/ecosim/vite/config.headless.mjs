import path from 'path';
import { defineConfig } from 'vite';

// Builds the headless target adapter: a plain-Node-importable ES module that
// runs the world without a renderer. The built entry keeps the source file's
// depth under the app root, so the adapter's app-relative asset paths resolve
// the same from source and from the build output.
export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(process.cwd(), "./src"),
            "@mindcraft-lang/docs": path.resolve(process.cwd(), "../../packages/docs/src"),
            "@mindcraft-lang/ui": path.resolve(process.cwd(), "../../packages/ui/src"),
        },
    },
    ssr: {
        external: ['@mindcraft-lang/core', 'phaser', 'miniplex'],
    },
    publicDir: false,
    logLevel: 'warn',
    build: {
        ssr: path.resolve(process.cwd(), 'src/rehearsal/adapter.ts'),
        outDir: 'dist-headless',
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
            output: {
                format: 'es',
                entryFileNames: 'rehearsal/adapter.js',
            },
        },
    },
});
