import { z } from 'zod';
import { EventIdSchema } from './event-id.js';

const taskId = () => z.string().min(1);
/** Client-generated idempotency key for a mutation command (e.g. a UUID). Servers must treat a repeated `commandId` as a no-op that returns the original result, never as a new attempt or an error. */
const commandId = () => z.string().min(1);

/**
 * Subscribes to a task's event stream. `afterEventId` omitted or `null`
 * requests a fresh subscription (a `task.snapshot` with no replay, per
 * `../replay/plan-replay.ts`); set it to resume after a previously seen
 * `eventId`.
 */
export const TaskSubscribeMessageSchema = z.object({
  type: z.literal('task.subscribe'),
  taskId: taskId(),
  afterEventId: EventIdSchema.nullable().optional(),
});
export type TaskSubscribeMessage = z.infer<typeof TaskSubscribeMessageSchema>;

/** Requests cancellation of the task's active run. Idempotent via `commandId`. */
export const TaskCancelMessageSchema = z.object({
  type: z.literal('task.cancel'),
  taskId: taskId(),
  commandId: commandId(),
});
export type TaskCancelMessage = z.infer<typeof TaskCancelMessageSchema>;

/** Resolves a pending `approval.required`. Idempotent via `commandId`. */
export const ApprovalResolveMessageSchema = z.object({
  type: z.literal('approval.resolve'),
  taskId: taskId(),
  approvalId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  commandId: commandId(),
});
export type ApprovalResolveMessage = z.infer<typeof ApprovalResolveMessageSchema>;

/**
 * The frozen client-to-server union (MIKADO.md "Frozen trunk contracts").
 * `task.cancel` and `approval.resolve` are mutation commands and carry a
 * `commandId`; `task.subscribe` is a read/subscribe command and does not,
 * since re-subscribing is naturally idempotent.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  TaskSubscribeMessageSchema,
  TaskCancelMessageSchema,
  ApprovalResolveMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
