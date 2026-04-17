import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import commonjs from '@rollup/plugin-commonjs';
import path from 'path';
import { uiPlugin } from '../../../packages/ui/src/vite-plugin.ts';
import { sitemapPlugin } from './sitemap-plugin.mjs';

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
    base: '/',
    plugins: [
        react(),
        uiPlugin(),
        sitemapPlugin(),
        phasermsg()
    ],
    resolve: {
        dedupe: ['sonner'],
        alias: {
            "@": path.resolve(process.cwd(), "./src"),
            "@mindcraft-lang/docs": path.resolve(process.cwd(), "../../packages/docs/src"),
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
            input: {
                main: path.resolve(process.cwd(), 'index.html'),
                'vfs-service-worker': path.resolve(process.cwd(), 'src/vfs-sw-entry.ts'),
            },
            external: [],
            plugins: [
                commonjs({
                    include: [/packages\/core/]
                })
            ],
            output: {
                entryFileNames(chunkInfo) {
                    if (chunkInfo.name === 'vfs-service-worker') {
                        return 'vfs-service-worker.js';
                    }
                    return 'assets/[name]-[hash].js';
                },
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
