import { z } from "zod";

/** Maximum byte length accepted for a single file's `content` field. */
export const MAX_FILE_CONTENT_BYTES = 512 * 1024;
/** Maximum total byte length of all file contents in a single snapshot. */
export const MAX_SNAPSHOT_CONTENT_BYTES = 16 * 1024 * 1024;

const fileSystemEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    content: z.string().max(MAX_FILE_CONTENT_BYTES),
    etag: z.string(),
    isReadonly: z.boolean(),
  }),
  z.object({ kind: z.literal("directory") }),
]);

const fileSystemEntriesSchema = z.array(z.tuple([z.string(), fileSystemEntrySchema]));

/**
 * Schema for a single filesystem mutation: write, delete, rename, mkdir, rmdir,
 * or a full `import` snapshot replacement.
 */
export const fileSystemNotificationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("write"),
    path: z.string(),
    content: z.string().max(MAX_FILE_CONTENT_BYTES),
    isReadonly: z.boolean().optional(),
    newEtag: z.string(),
    expectedEtag: z.string().optional(),
  }),
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
    entries: fileSystemEntriesSchema.refine(
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
  }),
]);

/** A single filesystem mutation transmitted over the bridge. */
export type FileSystemNotification = z.infer<typeof fileSystemNotificationSchema>;

/** Schema for a full filesystem snapshot used to seed or resync a peer. */
export const filesystemSyncPayloadSchema = z.object({
  entries: fileSystemEntriesSchema.refine(
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

/** Payload for `filesystem:sync`: a full snapshot of the workspace. */
export type FilesystemSyncPayload = z.infer<typeof filesystemSyncPayloadSchema>;
