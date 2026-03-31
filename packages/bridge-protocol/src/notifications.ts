import { z } from "zod";

const fileSystemEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), content: z.string(), etag: z.string(), isReadonly: z.boolean() }),
  z.object({ kind: z.literal("directory") }),
]);

const fileSystemEntriesSchema = z.array(z.tuple([z.string(), fileSystemEntrySchema]));

export const fileSystemNotificationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("write"),
    path: z.string(),
    content: z.string(),
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
    entries: fileSystemEntriesSchema,
  }),
]);

export type FileSystemNotification = z.infer<typeof fileSystemNotificationSchema>;

export const filesystemSyncPayloadSchema = z.object({
  entries: fileSystemEntriesSchema,
});

export type FilesystemSyncPayload = z.infer<typeof filesystemSyncPayloadSchema>;
