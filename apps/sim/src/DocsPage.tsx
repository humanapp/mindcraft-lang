import { withMindcraftEnvironmentServices } from "@mindcraft-lang/core";
import { getBrainServices } from "@mindcraft-lang/core/brain";
import { DocsPage as SharedDocsPage } from "@mindcraft-lang/docs";
import { Toaster } from "@mindcraft-lang/ui";
import { useMemo } from "react";
import { genVisualForTile } from "./brain/tiles/visual-provider";
import { createDocsRegistry } from "./docs/docs-registry";
import { getMindcraftEnvironment } from "./services/mindcraft-environment";

function withSimDocsBrainServices<T>(callback: () => T): T {
  return withMindcraftEnvironmentServices(getMindcraftEnvironment(), callback);
}

export default function DocsPage() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);
  const docsTileCatalog = useMemo(() => withSimDocsBrainServices(() => getBrainServices().tiles), []);

  return (
    <SharedDocsPage
      registry={docsRegistry}
      tileCatalog={docsTileCatalog}
      resolveTileVisual={genVisualForTile}
      withBrainServices={withSimDocsBrainServices}
      backLabel="Sim"
      backHref="/"
    >
      <Toaster />
    </SharedDocsPage>
  );
}
