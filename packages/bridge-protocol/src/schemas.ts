import { z } from "zod";

export const wsMessageSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  payload: z.unknown().optional(),
  seq: z.number().optional(),
});

export type WsMessage = z.infer<typeof wsMessageSchema>;
