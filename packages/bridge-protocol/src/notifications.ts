import { z } from "zod";

export const MAX_FILE_CONTENT_BYTES = 512 * 1024;
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

export type FileSystemNotification = z.infer<typeof fileSystemNotificationSchema>;

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

export type FilesystemSyncPayload = z.infer<typeof filesystemSyncPayloadSchema>;
