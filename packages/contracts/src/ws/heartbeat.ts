import { z } from 'zod';

/**
 * Ping/pong heartbeat shape (MIKADO.md design decisions mention a
 * "ping/pong heartbeat"). Design choice (T3): heartbeats are modeled here
 * as plain Zod schemas for type-sharing convenience, but they are
 * deliberately **not** members of {@link ServerMessageSchema} or
 * {@link ClientMessageSchema} and are not accepted by `parseServerMessage`
 * / `parseClientMessage`.
 *
 * Rationale: heartbeats are a transport-liveness concern, not a task
 * domain event or command — they have no `taskId`, are never persisted to
 * a `TaskEventLog`, and must never consume an `eventId` position. A
 * gateway implementation (B1/F2) may send/receive these as raw frames (or
 * use the underlying WebSocket protocol's native ping/pong control
 * frames instead) without them ever reaching task-message parsing.
 */
export const PingMessageSchema = z.object({
  type: z.literal('ping'),
  sentAt: z.string().datetime(),
});
export type PingMessage = z.infer<typeof PingMessageSchema>;

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
  /** Echoes the triggering ping's `sentAt` so RTT can be measured. */
  sentAt: z.string().datetime(),
});
export type PongMessage = z.infer<typeof PongMessageSchema>;
