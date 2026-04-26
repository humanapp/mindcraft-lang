import { z } from "zod";

/**
 * Envelope every bridge WebSocket message conforms to before its `type`-specific
 * payload is validated against a narrower schema.
 */
export const wsMessageSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  payload: z.unknown().optional(),
  seq: z.number().optional(),
});

/** Generic envelope for any bridge WebSocket message. */
export type WsMessage = z.infer<typeof wsMessageSchema>;
