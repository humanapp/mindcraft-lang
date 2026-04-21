import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import DocsPage from "./DocsPage.tsx";
import "./globals.css";

import { LogLevel, logger } from "@mindcraft-lang/core/app";
import { enableClipboardLogging } from "@mindcraft-lang/ui";
import { SimEnvironmentProvider } from "./contexts/sim-environment";
import { SimEnvironmentStore } from "./services/sim-environment-store";

enableClipboardLogging(true);
logger.level = LogLevel.DEBUG;

const simStore = await SimEnvironmentStore.create();
await simStore.initialize();

// React 19 dev mode calls performance.measure() on every render/commit and
// never clears the entries, leaking PerformanceMeasure objects indefinitely.
// Periodically flush them to prevent multi-million-object accumulation during
// long dev sessions. Has no effect in production builds.
if (import.meta.env.DEV) {
  setInterval(() => performance.clearMeasures(), 10_000);
}

const root = document.getElementById("root");
if (!root) throw new Error("Failed to find the root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <SimEnvironmentProvider value={simStore}>
      {window.location.pathname.startsWith("/docs") ? <DocsPage /> : <App />}
    </SimEnvironmentProvider>
  </React.StrictMode>
);
