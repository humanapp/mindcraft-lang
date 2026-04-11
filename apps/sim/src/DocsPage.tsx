import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import { DocsPage as SharedDocsPage } from "@mindcraft-lang/docs";
import { Toaster } from "@mindcraft-lang/ui";
import { useMemo } from "react";
import { genVisualForTile } from "./brain/editor/visual-provider";
import { createDocsRegistry } from "./docs/docs-registry";
import { getMindcraftEnvironment } from "./services/mindcraft-environment";

export default function DocsPage() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);
  const docsTileCatalog = useMemo<ITileCatalog>(() => {
    const env = getMindcraftEnvironment();
    return {
      get: (tileId: string) => {
        for (const catalog of env.tileCatalogs()) {
          const def = catalog.get(tileId);
          if (def) return def;
        }
        return undefined;
      },
    } as ITileCatalog;
  }, []);

  return (
    <SharedDocsPage
      registry={docsRegistry}
      tileCatalog={docsTileCatalog}
      brainServices={getMindcraftEnvironment().brainServices}
      resolveTileVisual={genVisualForTile}
      backLabel="Sim"
      backHref="/"
    >
      <Toaster />
    </SharedDocsPage>
  );
}
