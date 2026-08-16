/**
 * Contents of a project file: decoded text for a UTF-8 text file, or the raw
 * bytes for a file that is not text (a PNG tile icon, for example).
 */
export type FileContent = string | Uint8Array;

/**
 * JSON-safe form of a {@link FileContent}. Text travels verbatim; bytes travel
 * as base64 and are marked by `encoding`.
 */
export interface WireFileContent {
  /** The file's text, or its bytes as base64 when `encoding` is `"base64"`. */
  content: string;
  /** Present only for binary content. */
  encoding?: "base64";
}

/** True when `content` holds raw bytes. */
export function isBinaryFileContent(content: FileContent): content is Uint8Array {
  return typeof content !== "string";
}

/** The text of `content`, or `undefined` when it holds raw bytes. */
export function fileContentText(content: FileContent): string | undefined {
  return typeof content === "string" ? content : undefined;
}

/**
 * Classify `bytes` as text or binary and return the matching representation:
 * the decoded string when the bytes are UTF-8 text carrying no NUL byte, and
 * `bytes` unchanged otherwise.
 */
export function fileContentFromBytes(bytes: Uint8Array): FileContent {
  if (bytes.includes(0)) {
    return bytes;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }
}

/** The bytes `content` represents: its UTF-8 encoding for text, or the bytes themselves. */
export function fileContentToBytes(content: FileContent): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/** Byte length of `content` as it would be written to disk. */
export function fileContentByteLength(content: FileContent): number {
  return typeof content === "string" ? new TextEncoder().encode(content).byteLength : content.byteLength;
}

/** True when `a` and `b` carry the same content: the same text, or the same bytes. */
export function fileContentEquals(a: FileContent, b: FileContent): boolean {
  if (typeof a === "string" || typeof b === "string") {
    return a === b;
  }
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let index = 0; index < a.byteLength; index++) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/** Encode `content` for a JSON transport. */
export function fileContentToWire(content: FileContent): WireFileContent {
  return typeof content === "string" ? { content } : { content: bytesToBase64(content), encoding: "base64" };
}

/** Decode a {@link WireFileContent} into a {@link FileContent}. */
export function fileContentFromWire(wire: WireFileContent): FileContent {
  return wire.encoding === "base64" ? base64ToBytes(wire.content) : wire.content;
}

/** Encode bytes as base64 text. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Decode base64 text into bytes. */
export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
