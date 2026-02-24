import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import commonjs from '@rollup/plugin-commonjs';
import path from 'path';

const phasermsg = () => {
    return {
        name: 'phasermsg',
        buildStart() {
            process.stdout.write(`Building for production...\n`);
        },
        buildEnd() {
            process.stdout.write(` Done \n`);
        }
    }
}

export default defineConfig({
    base: './',
    plugins: [
        react(),
        phasermsg()
    ],
    resolve: {
        alias: {
            "@": path.resolve(process.cwd(), "./src"),
            "@mindcraft-lang/ui": path.resolve(process.cwd(), "../../packages/ui/src"),
        },
    },
    optimizeDeps: {
        exclude: ['@mindcraft-lang/core']
    },
    ssr: {
        noExternal: ['@mindcraft-lang/core']
    },
    logLevel: 'warning',
    build: {
        rollupOptions: {
            external: [],
            plugins: [
                commonjs({
                    include: [/packages\/core/]
                })
            ],
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 2
            },
            mangle: true,
            format: {
                comments: false
            }
        }
    }
});
