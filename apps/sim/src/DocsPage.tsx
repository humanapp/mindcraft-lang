import { DocsPage as SharedDocsPage } from "@mindcraft-lang/docs";
import { Toaster } from "@mindcraft-lang/ui";
import { useMemo } from "react";
import { genVisualForTile } from "./brain/editor/visual-provider";
import { createDocsRegistry } from "./docs/docs-registry";
import { getMindcraftEnvironment, withSimBrainServices } from "./services/mindcraft-environment";

export default function DocsPage() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);
  const docsTileCatalog = useMemo(() => getMindcraftEnvironment().brainServices.tiles, []);

  return (
    <SharedDocsPage
      registry={docsRegistry}
      tileCatalog={docsTileCatalog}
      resolveTileVisual={genVisualForTile}
      withBrainServices={withSimBrainServices}
      backLabel="Sim"
      backHref="/"
    >
      <Toaster />
    </SharedDocsPage>
  );
}
