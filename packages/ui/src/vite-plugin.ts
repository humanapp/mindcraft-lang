import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const fontsDir = resolve(pluginDir, "assets/fonts");
const fontFileName = "latinmodern-math.woff2";
const fontPublicPath = `/assets/fonts/${fontFileName}`;

/**
 * Vite plugin for @mindcraft-lang/ui.
 *
 * Handles the Latin Modern Math font, which lives in the ui package but must
 * be served as a static asset by each consuming app:
 *
 * - transform: rewrites the relative font url() in CSS modules to an absolute
 *   path (covers dev mode where each CSS file is a separate Vite module).
 * - configureServer: serves the font from the package source during dev.
 * - generateBundle: emits the font into the build output and rewrites the font
 *   url() in all assembled CSS assets (covers production where @import
 *   inlining happens before transform runs).
 */
export function uiPlugin() {
  return {
    name: "mindcraft-ui",

    transform(code: string, id: string) {
      if (id.endsWith(".css") && code.includes(fontFileName)) {
        return {
          code: code.replace(/url\(["'][^"']*latinmodern-math\.woff2["']\)/g, `url("${fontPublicPath}")`),
          map: null,
        };
      }
    },

    // biome-ignore lint/suspicious/noExplicitAny: Vite types not available in source-only package
    configureServer(server: any) {
      // biome-ignore lint/suspicious/noExplicitAny: Vite types not available in source-only package
      server.middlewares.use((req: any, res: any, next: () => void) => {
        if (req.url === fontPublicPath) {
          const data = readFileSync(resolve(fontsDir, fontFileName));
          res.setHeader("Content-Type", "font/woff2");
          res.end(data);
          return;
        }
        next();
      });
    },

    // biome-ignore lint/suspicious/noExplicitAny: Rollup types not available in source-only package
    generateBundle(this: any, _options: any, bundle: Record<string, any>) {
      // Emit the font file into the build output.
      this.emitFile({
        type: "asset",
        fileName: `assets/fonts/${fontFileName}`,
        source: readFileSync(resolve(fontsDir, fontFileName)),
      });

      // Rewrite the font url() in all assembled CSS assets. This is the
      // reliable production-build fix: @import inlining happens before
      // transform runs, so the URL must be rewritten here instead.
      for (const asset of Object.values(bundle)) {
        if (asset.type === "asset" && typeof asset.source === "string" && asset.source.includes(fontFileName)) {
          asset.source = asset.source.replace(
            /url\(["']?[^"'()]*latinmodern-math\.woff2["']?\)/g,
            `url("${fontPublicPath}")`
          );
        }
      }
    },
  };
}
