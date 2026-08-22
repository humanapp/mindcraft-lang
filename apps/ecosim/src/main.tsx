import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import DocsPage from "./DocsPage.tsx";
import "./globals.css";

import { LogLevel, logger } from "@wendoo/core/app";
import { enableClipboardLogging } from "@wendoo/ui";
import { loadAnalytics } from "./analytics";
import { EcosimEnvironmentProvider } from "./contexts/ecosim-environment";
import { EcosimEnvironmentStore } from "./services/ecosim-environment-store";

enableClipboardLogging(true);
logger.level = LogLevel.DEBUG;

loadAnalytics();

// React 19 dev mode calls performance.measure() on every render/commit and
// never clears the entries, leaking PerformanceMeasure objects indefinitely.
// Periodically flush them to prevent multi-million-object accumulation during
// long dev sessions. Has no effect in production builds.
if (import.meta.env.DEV) {
  setInterval(() => performance.clearMeasures(), 10_000);
}

(async () => {
  let disposed = false;
  const ecosimStore = await EcosimEnvironmentStore.create();
  const disposeSimStore = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    ecosimStore.dispose();
  };
  window.addEventListener("pagehide", disposeSimStore, { once: true });
  // Going hidden commits the pending project save; the store stays alive.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void ecosimStore.projectManager.flushAutoSave();
    }
  });
  import.meta.hot?.dispose(disposeSimStore);

  await ecosimStore.initialize();

  const root = document.getElementById("root");
  if (!root) throw new Error("Failed to find the root element");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <EcosimEnvironmentProvider value={ecosimStore}>
        {window.location.pathname.startsWith("/docs") ? <DocsPage /> : <App />}
      </EcosimEnvironmentProvider>
    </React.StrictMode>
  );
})();
