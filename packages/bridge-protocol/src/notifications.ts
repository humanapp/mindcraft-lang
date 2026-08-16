import { z } from "zod";

/** Maximum byte length accepted for a single file's `content` field. */
export const MAX_FILE_CONTENT_BYTES = 512 * 1024;
/** Maximum total byte length of all file contents in a single snapshot. */
export const MAX_SNAPSHOT_CONTENT_BYTES = 16 * 1024 * 1024;

/** Marks a `content` field as base64-encoded bytes. Absent for a text file. */
const contentEncodingSchema = z.literal("base64").optional();

/**
 * Byte length the carried content represents: the base64 payload's decoded
 * length for binary content, and the string's own length for text.
 */
function carriedByteLength(carried: { content: string; encoding?: "base64" }): number {
  if (carried.encoding !== "base64") {
    return carried.content.length;
  }
  const padding = carried.content.endsWith("==") ? 2 : carried.content.endsWith("=") ? 1 : 0;
  return Math.floor((carried.content.length * 3) / 4) - padding;
}

/** Rejects a file whose carried content exceeds {@link MAX_FILE_CONTENT_BYTES}. */
const withinFileContentCap = {
  check: (carried: { content: string; encoding?: "base64" }) => carriedByteLength(carried) <= MAX_FILE_CONTENT_BYTES,
  message: `File content exceeds ${MAX_FILE_CONTENT_BYTES} bytes`,
};

/**
 * A file's contents as carried on the wire: its text, or its bytes as base64
 * when `encoding` is `"base64"`.
 */
export interface FileContentPayload {
  content: string;
  encoding?: "base64";
}

const filesystemEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("file"),
      content: z.string(),
      encoding: contentEncodingSchema,
      etag: z.string(),
      isReadonly: z.boolean(),
    })
    .refine(withinFileContentCap.check, { message: withinFileContentCap.message }),
  z.object({ kind: z.literal("directory") }),
]);

const filesystemEntriesSchema = z.array(z.tuple([z.string(), filesystemEntrySchema]));

/**
 * Schema for a single filesystem mutation: write, delete, rename, mkdir, rmdir,
 * or a full `import` snapshot replacement.
 */
export const filesystemNotificationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("write"),
      path: z.string(),
      content: z.string(),
      encoding: contentEncodingSchema,
      isReadonly: z.boolean().optional(),
      newEtag: z.string(),
      expectedEtag: z.string().optional(),
    })
    .refine(withinFileContentCap.check, { message: withinFileContentCap.message }),
  z.object({ action: z.literal("delete"), path: z.string(), expectedEtag: z.string().optional() }),
  z.object({
    action: z.literal("rename"),
    oldPath: z.string(),
    newPath: z.string(),
    expectedEtag: z.string().optional(),
  }),
  z.object({ action: z.literal("mkdir"), path: z.string() }),
  z.object({ action: z.literal("rmdir"), path: z.string() }),
  z.object({
    action: z.literal("import"),
    entries: filesystemEntriesSchema.refine(
      (entries) => {
        let totalBytes = 0;
        for (const [, entry] of entries) {
          if (entry.kind === "file") {
            totalBytes += carriedByteLength(entry);
            if (totalBytes > MAX_SNAPSHOT_CONTENT_BYTES) return false;
          }
        }
        return true;
      },
      { message: `Total snapshot content exceeds ${MAX_SNAPSHOT_CONTENT_BYTES / (1024 * 1024)} MB limit` }
    ),
  }),
]);

/** A single filesystem mutation transmitted over the bridge. */
export type FileSystemNotification = z.infer<typeof filesystemNotificationSchema>;

/** Schema for a full filesystem snapshot used to seed or resync a peer. */
export const filesystemSyncPayloadSchema = z.object({
  entries: filesystemEntriesSchema.refine(
    (entries) => {
      let totalBytes = 0;
      for (const [, entry] of entries) {
        if (entry.kind === "file") {
          totalBytes += entry.content.length;
          if (totalBytes > MAX_SNAPSHOT_CONTENT_BYTES) return false;
        }
      }
      return true;
    },
    { message: `Total snapshot content exceeds ${MAX_SNAPSHOT_CONTENT_BYTES / (1024 * 1024)} MB limit` }
  ),
});

/** Payload for `filesystem:sync`: a full filesystem snapshot. */
export type FilesystemSyncPayload = z.infer<typeof filesystemSyncPayloadSchema>;
