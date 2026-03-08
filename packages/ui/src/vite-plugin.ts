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
 * - transform: rewrites the relative font url() in ui.css to an absolute
 *   path so it resolves correctly regardless of where the built CSS ends up.
 * - configureServer: serves the font from the package source during dev.
 * - generateBundle: emits the font into the app build output.
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

    // biome-ignore lint/suspicious/noExplicitAny: Rollup PluginContext not available in source-only package
    generateBundle(this: any) {
      const source = readFileSync(resolve(fontsDir, fontFileName));
      this.emitFile({
        type: "asset",
        fileName: `assets/fonts/${fontFileName}`,
        source,
      });
    },
  };
}
