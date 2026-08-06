import { staticAssetUrl } from "@mindcraft-lang/ui/asset-url";

/**
 * Base URL for the brain tile SVG icons served from `public/assets/brain/icons`.
 * Resolved against the app's build base so the URLs stay correct under a
 * relative base (for example inside the VS Code webview). Build icon URLs as
 * `${ICON_BASE}/name.svg`.
 */
export const ICON_BASE = staticAssetUrl("assets/brain/icons");
