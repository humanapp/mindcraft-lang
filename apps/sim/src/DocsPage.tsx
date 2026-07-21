import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import { DocsPage as SharedDocsPage } from "@mindcraft-lang/docs";
import { Toaster } from "@mindcraft-lang/ui";
import { useMemo } from "react";
import { dataTypeIconMap, dataTypeNameMap } from "./brain/editor/data-type-icons";
import { createVfsAwareVisualProvider } from "./brain/editor/visual-provider";
import { useSimEnvironment } from "./contexts/sim-environment";
import { createDocsRegistry } from "./docs/docs-registry";

export default function DocsPage() {
  const store = useSimEnvironment();
  const docsRegistry = useMemo(() => createDocsRegistry(store.userTileDocEntries), [store]);
  const resolveTileVisual = useMemo(
    () => createVfsAwareVisualProvider((url) => store.resolveVfsAssetUrl(url)),
    [store]
  );
  const docsTileCatalog = useMemo<ITileCatalog>(() => {
    return {
      get: (tileId: string) => {
        for (const catalog of store.env.tileCatalogs()) {
          const def = catalog.get(tileId);
          if (def) return def;
        }
        return undefined;
      },
    } as ITileCatalog;
  }, [store]);

  return (
    <SharedDocsPage
      registry={docsRegistry}
      tileCatalog={docsTileCatalog}
      brainServices={store.env.brainServices}
      libraries={store.host.installedLibraries}
      dataTypeNames={dataTypeNameMap}
      dataTypeIcons={dataTypeIconMap}
      resolveTileVisual={resolveTileVisual}
      backLabel="Sim"
      backHref="/"
    >
      <Toaster />
    </SharedDocsPage>
  );
}
