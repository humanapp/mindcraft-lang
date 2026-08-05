/**
 * Inject the umami analytics script. Does nothing on localhost or 127.0.0.1, so
 * local dev servers do not report. Carries no domain allowlist, so every
 * deployed host reports -- the standalone web build and the VS Code webview host
 * alike. Call once during startup.
 */
export function loadAnalytics(): void {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "") {
    return;
  }
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://cloud.umami.is/script.js";
  script.dataset.websiteId = "39403070-285f-4514-a874-4808d684adbf";
  document.head.appendChild(script);
}
