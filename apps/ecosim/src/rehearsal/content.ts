import type { TileDocContent } from "@wendoo/assistant-bridge/kit";

/** The brain document the app ships for each archetype, base64-encoded and keyed by archetype name. */
export type ShippedBrainDefs = Readonly<Record<string, string>>;

/** The app's own assets a rehearsal reads, carried with the module graph. */
export interface RehearsalContent {
  /** Wendoo identity the adapter built over this content reports. */
  readonly targetIdentity: string;
  /** The app's tile documentation as raw markdown keyed by content key. */
  readonly tileDocs: TileDocContent;
  readonly shippedBrains: ShippedBrainDefs;
}

/**
 * The content this module graph was built with, from its build-time
 * replacements. Throws when the graph was built without them.
 */
export function injectedContent(): RehearsalContent {
  if (
    typeof TARGET_IDENTITY !== "string" ||
    typeof TILE_DOC_CONTENT !== "object" ||
    typeof SHIPPED_BRAIN_DEFS !== "object"
  ) {
    throw new Error(
      "this build defines none of TARGET_IDENTITY, TILE_DOC_CONTENT and SHIPPED_BRAIN_DEFS, so the rehearsal carries no content"
    );
  }
  return { targetIdentity: TARGET_IDENTITY, tileDocs: TILE_DOC_CONTENT, shippedBrains: SHIPPED_BRAIN_DEFS };
}

/**
 * The brain document `shipped` carries for `archetype`, decoded to its bytes.
 * Throws when it carries none.
 */
export function shippedBrainBytes(shipped: ShippedBrainDefs, archetype: string): ArrayBuffer {
  const encoded = shipped[archetype];
  if (encoded === undefined) throw new Error(`no brain document is shipped for ${archetype}`);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
