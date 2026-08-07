import { z } from "zod";

/**
 * Version of the relay wire this package defines. A session speaks one version
 * end to end: the client declares the version it holds when it connects, and
 * the service admits only its own.
 */
export const ASSISTANT_RELAY_PROTOCOL_VERSION = 1;

/**
 * Identifier of one relay session. The service mints it from a globally unique
 * source when it accepts a connection; a client never mints or supplies one.
 */
export type RelaySessionId = string;

/**
 * What the client serves and what it asks the session to be. Every field is a
 * request or a description of the client.
 */
export interface RelayToolManifest {
  /** Target the client asks to author for, by the Mindcraft identity its target declares. */
  readonly target: string;
  /** Names of the bridge tools the client serves, in ascending order. */
  readonly tools: readonly string[];
  /** `true` when the client also serves the bridge's morphology extension. */
  readonly morphology: boolean;
  /** Hash of the catalog digest the client's editor holds, as `catalogDigest` reports it. */
  readonly catalogDigest: string;
}

/** Schema of {@link RelayToolManifest}. */
export const relayToolManifestSchema = z.strictObject({
  target: z.string().min(1),
  tools: z.array(z.string().min(1)),
  morphology: z.boolean(),
  catalogDigest: z.string().min(1),
});

/** First message of a session: the wire version the client speaks and what it serves. */
export interface RelayConnect {
  readonly type: "session:connect";
  /** Wire version the client holds, as {@link ASSISTANT_RELAY_PROTOCOL_VERSION} spells it. */
  readonly protocolVersion: number;
  readonly manifest: RelayToolManifest;
}

/** The session is open, and this is what to call it. */
export interface RelayConnectAccepted {
  readonly type: "session:accepted";
  readonly sessionId: RelaySessionId;
}

/** Why the service would not open a session. */
export const RelayRefusalCode = {
  /**
   * The client declared a wire version other than the one the service speaks.
   * The client reloads to pick up the current build and connects again; no
   * session spans two versions.
   */
  ProtocolVersionMismatch: "protocol_version_mismatch",
  /**
   * The service does not serve the target the manifest asked for. Does not
   * distinguish a target the service does not know from one this session may
   * not claim.
   */
  TargetUnavailable: "target_unavailable",
} as const;

/** Why the service would not open a session. */
export type RelayRefusalCode = (typeof RelayRefusalCode)[keyof typeof RelayRefusalCode];

/** The session is not open, and why. */
export interface RelayConnectRefused {
  readonly type: "session:refused";
  readonly code: RelayRefusalCode;
  /** Wire version the service speaks. */
  readonly protocolVersion: number;
  /** Human-readable context; the code is the contract. */
  readonly message?: string;
}
