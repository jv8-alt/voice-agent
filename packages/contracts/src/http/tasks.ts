import { z } from 'zod';
import { SnapshotEnvelopeSchema, TaskViewSchema, TurnModeSchema, TurnSchema } from '../domain.js';
import { ReplayableServerMessageSchema } from '../ws/server-messages.js';

const taskId = () => z.string().min(1);

export const GetTasksResponseSchema = z.object({ tasks: z.array(TaskViewSchema) });
export type GetTasksResponse = z.infer<typeof GetTasksResponseSchema>;

/**
 * `POST /tasks` request. The initial turn's text and {@link TurnModeSchema}
 * ride along with task creation (there is always exactly one turn at
 * creation time; later turns use `POST /tasks/:id/turns`).
 */
export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1),
  turn: z.object({
    mode: TurnModeSchema,
    text: z.string().min(1),
  }).strict(),
}).strict();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

/**
 * Design choice (T3): `POST /tasks` and `GET /tasks/:id` both return a
 * {@link SnapshotEnvelopeSchema} rather than a bare task view. The
 * client needs `turns`/`updates`/`pendingApproval` immediately to render
 * the thread without a required follow-up request, and returning the same
 * shape from both endpoints means one client-side parser handles "task
 * just created" and "task loaded on deep-link" identically.
 */
export const CreateTaskResponseSchema = SnapshotEnvelopeSchema;
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>;

export const GetTaskParamsSchema = z.object({ taskId: taskId() });
export type GetTaskParams = z.infer<typeof GetTaskParamsSchema>;

export const GetTaskResponseSchema = SnapshotEnvelopeSchema;
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;

export const CreateTurnParamsSchema = z.object({ taskId: taskId() });
export type CreateTurnParams = z.infer<typeof CreateTurnParamsSchema>;

export const CreateTurnRequestSchema = z.object({
  mode: TurnModeSchema,
  text: z.string().min(1),
}).strict();
export type CreateTurnRequest = z.infer<typeof CreateTurnRequestSchema>;

/**
 * Design choice (T3): `POST /tasks/:id/turns` returns just the created
 * {@link TurnSchema}, not a full snapshot — the caller already holds the
 * task's current state and receives the resulting `turn.created`,
 * `intent.confirmed`, etc. over the WebSocket; re-sending the whole
 * snapshot here would be redundant.
 */
export const CreateTurnResponseSchema = TurnSchema;
export type CreateTurnResponse = z.infer<typeof CreateTurnResponseSchema>;

export const GetTaskEventsParamsSchema = z.object({ taskId: taskId() });
export type GetTaskEventsParams = z.infer<typeof GetTaskEventsParamsSchema>;

export const GetTaskEventsQuerySchema = z.object({
  /** Required cursor from the latest snapshot or previously received event. */
  after: z.string().regex(/^(0|[1-9][0-9]*)$/),
}).strict();
export type GetTaskEventsQuery = z.infer<typeof GetTaskEventsQuerySchema>;

/**
 * Mirrors `PlanReplayResult` from `../replay/plan-replay.ts` exactly (same
 * `kind` discriminant) so the HTTP replay fallback and the WebSocket
 * replay path share one mental model and one client-side handler shape.
 */
export const GetTaskEventsResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replay'), events: z.array(ReplayableServerMessageSchema) }),
  z.object({ kind: z.literal('resync_required') }),
]);
export type GetTaskEventsResponse = z.infer<typeof GetTaskEventsResponseSchema>;

/**
 * `GET /ws` upgrades the connection to a WebSocket; it has no JSON
 * request or response body. After the handshake, all traffic follows
 * `ClientMessageSchema` / `ServerMessageSchema` from `../ws/`. This
 * constant exists only to give the OpenAPI generator and endpoint
 * inventory one canonical reference for the path.
 */
export const WS_UPGRADE_ENDPOINT_PATH = '/ws' as const;
