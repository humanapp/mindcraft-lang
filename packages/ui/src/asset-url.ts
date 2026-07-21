/**
 * Resolve an app-served static asset path (for example
 * "assets/brain/icons/boolean.svg") against the consuming app's build base
 * URL. With a root base the result is root-absolute ("/assets/...`); with a
 * relative base the result resolves against the document URL. A leading
 * slash on `path` is ignored. Outside a Vite build (for example in tests)
 * the base defaults to "/".
 */
export function staticAssetUrl(path: string): string {
  const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
  const base = env?.BASE_URL ?? "/";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return base.endsWith("/") ? `${base}${trimmed}` : `${base}/${trimmed}`;
}
