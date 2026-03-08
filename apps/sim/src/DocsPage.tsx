import { DocsPage as SharedDocsPage } from "@mindcraft-lang/docs";
import { Toaster } from "@mindcraft-lang/ui";
import { useMemo } from "react";
import { createDocsRegistry } from "./docs/docs-registry";

export default function DocsPage() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);

  return (
    <SharedDocsPage registry={docsRegistry} backLabel="Sim" backHref="/">
      <Toaster />
    </SharedDocsPage>
  );
}
