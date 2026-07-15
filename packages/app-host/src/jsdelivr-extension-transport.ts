import type {
  ExtensionFetchBranchResult,
  ExtensionFetchFileResult,
  ExtensionFetchTransport,
  ExtensionVersionListResult,
} from "./extension-fetch.js";

/** Default base URL of the jsDelivr CDN serving GitHub repository files. */
export const JSDELIVR_CDN_BASE_URL = "https://cdn.jsdelivr.net";

/** Default base URL of the jsDelivr data API. */
export const JSDELIVR_DATA_API_BASE_URL = "https://data.jsdelivr.com";

/** Default base URL of the GitHub REST API answering branch resolution requests. */
export const GITHUB_API_BASE_URL = "https://api.github.com";

/** Options for {@link createJsDelivrExtensionTransport}. */
export interface JsDelivrExtensionTransportOptions {
  /** Base URL serving `/gh/<owner>/<repo>@<pin>/<path>` file requests. Defaults to {@link JSDELIVR_CDN_BASE_URL}. */
  readonly cdnBaseUrl?: string;
  /** Base URL of the data API answering version-listing requests. Defaults to {@link JSDELIVR_DATA_API_BASE_URL}. */
  readonly dataApiBaseUrl?: string;
  /** Base URL of the GitHub REST API answering branch resolution requests. Defaults to {@link GITHUB_API_BASE_URL}. */
  readonly githubApiBaseUrl?: string;
  /** Fetch implementation. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** True when a GitHub API response signals an exhausted anonymous rate limit. */
function isGithubRateLimited(response: Response): boolean {
  if (response.status === 429) {
    return true;
  }
  return response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
}

/**
 * Create the {@link ExtensionFetchTransport} over public GitHub repository
 * content: files are read from the jsDelivr CDN's
 * `/gh/<owner>/<repo>@<pin>/<path>` layout, published versions are listed
 * through the jsDelivr data API's `/v1/packages/gh/<owner>/<repo>` endpoint,
 * and a branch resolves to its head commit SHA through the GitHub REST API's
 * `/repos/<owner>/<repo>/branches/<branch>` endpoint. All requests are
 * anonymous HTTPS GETs.
 */
export function createJsDelivrExtensionTransport(options?: JsDelivrExtensionTransportOptions): ExtensionFetchTransport {
  const cdnBaseUrl = options?.cdnBaseUrl ?? JSDELIVR_CDN_BASE_URL;
  const dataApiBaseUrl = options?.dataApiBaseUrl ?? JSDELIVR_DATA_API_BASE_URL;
  const githubApiBaseUrl = options?.githubApiBaseUrl ?? GITHUB_API_BASE_URL;
  const fetchImpl = options?.fetchImpl ?? fetch;

  return {
    async fetchFile(owner: string, repo: string, pin: string, path: string): Promise<ExtensionFetchFileResult> {
      const url =
        `${cdnBaseUrl}/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
        `@${encodeURIComponent(pin)}/${encodePathSegments(path)}`;
      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch (error) {
        return { ok: false, kind: "unreachable", message: error instanceof Error ? error.message : String(error) };
      }
      if (response.status === 404 || response.status === 403) {
        // The CDN answers 403 for a repository it refuses to serve and 404 for
        // a missing file or version; both mean the content is not there.
        return { ok: false, kind: "not-found" };
      }
      if (!response.ok) {
        return { ok: false, kind: "http-status", status: response.status };
      }
      return { ok: true, content: new Uint8Array(await response.arrayBuffer()) };
    },

    async resolveBranch(owner: string, repo: string, branch: string): Promise<ExtensionFetchBranchResult> {
      const url =
        `${githubApiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
        `/branches/${encodeURIComponent(branch)}`;
      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch (error) {
        return { ok: false, kind: "unreachable", message: error instanceof Error ? error.message : String(error) };
      }
      if (response.status === 404) {
        return { ok: false, kind: "not-found" };
      }
      if (isGithubRateLimited(response)) {
        return { ok: false, kind: "rate-limited" };
      }
      if (!response.ok) {
        return { ok: false, kind: "http-status", status: response.status };
      }
      const body = (await response.json()) as { commit?: { sha?: string | null } | null };
      const sha = body.commit?.sha;
      if (typeof sha !== "string" || sha.length === 0) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, sha };
    },

    async listVersionTags(owner: string, repo: string): Promise<ExtensionVersionListResult> {
      const url = `${dataApiBaseUrl}/v1/packages/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch (error) {
        return { ok: false, kind: "unreachable", message: error instanceof Error ? error.message : String(error) };
      }
      if (response.status === 404) {
        return { ok: false, kind: "not-found" };
      }
      if (!response.ok) {
        return { ok: false, kind: "http-status", status: response.status };
      }
      const body = (await response.json()) as { versions?: readonly { version?: string | null }[] | null };
      const versions: string[] = [];
      for (const entry of body.versions ?? []) {
        if (typeof entry.version === "string" && entry.version.length > 0) {
          versions.push(entry.version);
        }
      }
      return { ok: true, versions };
    },
  };
}
