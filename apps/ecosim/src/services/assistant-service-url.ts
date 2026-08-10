/** Path the assistant service serves its relay session endpoint at. */
const kAssistantSessionPath = "api/assistant/session";

/**
 * Composes the WebSocket address of the assistant service's session endpoint
 * from the `assistantServiceUrl` app setting.
 *
 * `serviceUrl` is a host with an optional port; a scheme, if present, is
 * stripped and re-derived: the localhost family ("localhost", "127.0.0.1",
 * "[::1]") gets `ws://` and every other host gets `wss://`. Throws when
 * `serviceUrl` does not parse as a host.
 */
export function assistantSessionUrl(serviceUrl: string): string {
  const withoutScheme = serviceUrl.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, "");
  const parsed = new URL(`http://${withoutScheme}`);
  const { hostname, port } = parsed;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const scheme = isLocalhost ? "ws://" : "wss://";
  const portPart = port !== "" ? `:${port}` : "";
  return `${scheme}${hostname}${portPart}/${kAssistantSessionPath}`;
}
