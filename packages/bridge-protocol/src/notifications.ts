import { z } from "zod";

export const fileSystemNotificationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("write"),
    path: z.string(),
    content: z.string(),
    isReadonly: z.boolean().optional(),
    newEtag: z.string(),
  }),
  z.object({ action: z.literal("delete"), path: z.string() }),
  z.object({ action: z.literal("rename"), oldPath: z.string(), newPath: z.string() }),
  z.object({ action: z.literal("mkdir"), path: z.string() }),
  z.object({ action: z.literal("rmdir"), path: z.string() }),
  z.object({ action: z.literal("import") }),
]);

export type FileSystemNotification = z.infer<typeof fileSystemNotificationSchema>;
