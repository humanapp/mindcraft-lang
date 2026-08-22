/**
 * Test stub for `@wendoo/ui/asset-url`, mapped in `test/tsconfig.json`.
 * The real module resolves a path against the Vite build base; the parity test
 * only needs a deterministic string, and tile icon urls are excluded from
 * every comparison it makes.
 *
 * @param path - Asset path relative to the app's public root.
 * @returns `path`, unchanged.
 */
export function staticAssetUrl(path: string): string {
  return path;
}
