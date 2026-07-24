import { z } from 'zod';
import {
  ApprovalRequestSchema,
  ActionViewSchema,
  ExecutiveUpdateSchema,
  TaskViewSchema,
  TaskSnapshotSchema,
  TurnSchema,
} from '../domain.js';
import { TaskErrorProblemSchema } from '../errors.js';
import { TurnStatusSchema } from '../status.js';
import { EventIdSchema } from './event-id.js';

const taskId = () => z.string().min(1);
const turnId = () => z.string().min(1);

/**
 * Sent once per connection, before any task subscription. Not task-scoped,
 * so it carries no `eventId` — it is never appended to a task's replayable
 * event log.
 */
export const ConnectionReadyMessageSchema = z.object({
  type: z.literal('connection.ready'),
  connectionId: z.string().min(1),
});
export type ConnectionReadyMessage = z.infer<typeof ConnectionReadyMessageSchema>;

/** Full state sent immediately after a successful `task.subscribe`. */
export const TaskSnapshotMessageSchema = z.object({
  type: z.literal('task.snapshot'),
  taskId: taskId(),
  snapshot: TaskSnapshotSchema,
  lastEventId: EventIdSchema.nullable(),
});
export type TaskSnapshotMessage = z.infer<typeof TaskSnapshotMessageSchema>;

export const TaskCreatedMessageSchema = z.object({
  type: z.literal('task.created'),
  eventId: EventIdSchema,
  task: TaskViewSchema,
});
export type TaskCreatedMessage = z.infer<typeof TaskCreatedMessageSchema>;

export const TurnCreatedMessageSchema = z.object({
  type: z.literal('turn.created'),
  eventId: EventIdSchema,
  turn: TurnSchema,
});
export type TurnCreatedMessage = z.infer<typeof TurnCreatedMessageSchema>;

/** Emitted once a read-only plan is ready (the `understood` executive phase). */
export const IntentConfirmedMessageSchema = z.object({
  type: z.literal('intent.confirmed'),
  eventId: EventIdSchema,
  taskId: taskId(),
  turnId: turnId(),
  actions: z.array(ActionViewSchema),
});
export type IntentConfirmedMessage = z.infer<typeof IntentConfirmedMessageSchema>;

export const ProgressUpdatedMessageSchema = z.object({
  type: z.literal('progress.updated'),
  eventId: EventIdSchema,
  update: ExecutiveUpdateSchema,
});
export type ProgressUpdatedMessage = z.infer<typeof ProgressUpdatedMessageSchema>;

export const ApprovalRequiredMessageSchema = z.object({
  type: z.literal('approval.required'),
  eventId: EventIdSchema,
  approval: ApprovalRequestSchema,
});
export type ApprovalRequiredMessage = z.infer<typeof ApprovalRequiredMessageSchema>;

export const ApprovalResolvedMessageSchema = z.object({
  type: z.literal('approval.resolved'),
  eventId: EventIdSchema,
  taskId: taskId(),
  approvalId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  commandId: z.string().min(1),
});
export type ApprovalResolvedMessage = z.infer<typeof ApprovalResolvedMessageSchema>;

export const TurnStatusChangedMessageSchema = z.object({
  type: z.literal('turn.status_changed'),
  eventId: EventIdSchema,
  taskId: taskId(),
  turnId: turnId(),
  status: TurnStatusSchema,
});
export type TurnStatusChangedMessage = z.infer<typeof TurnStatusChangedMessageSchema>;

export const TaskCompletedMessageSchema = z.object({
  type: z.literal('task.completed'),
  eventId: EventIdSchema,
  taskId: taskId(),
  turnId: turnId(),
  update: ExecutiveUpdateSchema,
});
export type TaskCompletedMessage = z.infer<typeof TaskCompletedMessageSchema>;

export const TaskCancelledMessageSchema = z.object({
  type: z.literal('task.cancelled'),
  eventId: EventIdSchema,
  taskId: taskId(),
  turnId: turnId().nullable(),
  commandId: z.string().min(1),
});
export type TaskCancelledMessage = z.infer<typeof TaskCancelledMessageSchema>;

export const TaskFailedMessageSchema = z.object({
  type: z.literal('task.failed'),
  eventId: EventIdSchema,
  taskId: taskId(),
  turnId: turnId().nullable(),
  error: TaskErrorProblemSchema,
});
export type TaskFailedMessage = z.infer<typeof TaskFailedMessageSchema>;

/**
 * Sent instead of a replay when the server cannot service the client's
 * `afterEventId` cursor (see `../replay/plan-replay.ts`). Deliberately
 * carries no `eventId` of its own: it signals the *absence* of a valid
 * position, not a new position in the stream. The client must re-issue
 * `task.subscribe` with `afterEventId` unset to receive a fresh
 * `task.snapshot`.
 */
export const ResyncRequiredMessageSchema = z.object({
  type: z.literal('resync_required'),
  taskId: taskId(),
});
export type ResyncRequiredMessage = z.infer<typeof ResyncRequiredMessageSchema>;

/**
 * Typed error response for a rejected or failed client command (e.g. a
 * malformed `task.subscribe`, or a `task.cancel` for an unknown task).
 * Transport-level, like `resync_required`: it reports on a command, not a
 * position in a task's event log, so it carries no `eventId`.
 */
export const ServerErrorMessageSchema = z.object({
  type: z.literal('error'),
  error: TaskErrorProblemSchema,
  /** Echoes the failing command's `commandId` when the error is a direct response to one. */
  inReplyToCommandId: z.string().min(1).optional(),
});
export type ServerErrorMessage = z.infer<typeof ServerErrorMessageSchema>;

/**
 * The frozen server-to-client union (MIKADO.md "Frozen trunk contracts").
 * Every event-bearing variant (all except `connection.ready`,
 * `resync_required`, and `error` — see each schema's doc comment) carries
 * a monotonically increasing `eventId` so a client can resume with
 * `task.subscribe({ afterEventId })`.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  ConnectionReadyMessageSchema,
  TaskSnapshotMessageSchema,
  TaskCreatedMessageSchema,
  TurnCreatedMessageSchema,
  IntentConfirmedMessageSchema,
  ProgressUpdatedMessageSchema,
  ApprovalRequiredMessageSchema,
  ApprovalResolvedMessageSchema,
  TurnStatusChangedMessageSchema,
  TaskCompletedMessageSchema,
  TaskCancelledMessageSchema,
  TaskFailedMessageSchema,
  ResyncRequiredMessageSchema,
  ServerErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Messages that may be persisted and replayed. */
export const ReplayableServerMessageSchema = z.discriminatedUnion('type', [
  TaskCreatedMessageSchema,
  TurnCreatedMessageSchema,
  IntentConfirmedMessageSchema,
  ProgressUpdatedMessageSchema,
  ApprovalRequiredMessageSchema,
  ApprovalResolvedMessageSchema,
  TurnStatusChangedMessageSchema,
  TaskCompletedMessageSchema,
  TaskCancelledMessageSchema,
  TaskFailedMessageSchema,
]);
export type ReplayableServerMessage = z.infer<typeof ReplayableServerMessageSchema>;
