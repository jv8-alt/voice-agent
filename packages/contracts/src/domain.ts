import { z } from 'zod';
import { TaskErrorProblemSchema } from './errors.js';
import { TurnStatusSchema } from './status.js';

/** How a turn's input was captured. Voice (`ptt`/`handsfree`) is the demo's primary path; `typing` is a functional fallback. */
export const TurnModeSchema = z.enum(['ptt', 'handsfree', 'typing']);
export type TurnMode = z.infer<typeof TurnModeSchema>;

const timestamp = () => z.string().datetime();
const id = () => z.string().min(1);

/**
 * Server-only task record. One coding-agent thread is reused across a task's
 * turns; `agentThreadId` is unset until the first plan establishes it.
 */
export const TaskRecordSchema = z.object({
  id: id(),
  actorId: id(),
  workspaceId: id(),
  title: z.string().min(1),
  agentThreadId: z.string().min(1).nullable(),
  createdAt: timestamp(),
  updatedAt: timestamp(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

/** Browser-safe task summary. Status is derived from the latest turn. */
export const TaskViewSchema = z.object({
  id: id(),
  title: z.string().min(1),
  status: TurnStatusSchema,
  createdAt: timestamp(),
  updatedAt: timestamp(),
}).strict();
export type TaskView = z.infer<typeof TaskViewSchema>;

/** One user submission (voice or typed) within a task. */
export const TurnSchema = z.object({
  id: id(),
  taskId: id(),
  mode: TurnModeSchema,
  text: z.string().min(1),
  status: TurnStatusSchema,
  createdAt: timestamp(),
  updatedAt: timestamp(),
});
export type Turn = z.infer<typeof TurnSchema>;

/** A single action the coding agent proposes to take, surfaced during read-only planning. */
export const ProposedActionSchema = z.object({
  kind: z.enum(['read', 'write', 'exec', 'network', 'other']),
  summary: z.string().min(1),
  paths: z.array(z.string()).optional(),
  command: z.string().optional(),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

/** Sanitized action information safe for browser disclosure. */
export const ActionViewSchema = z.object({
  kind: ProposedActionSchema.shape.kind,
  summary: z.string().min(1),
}).strict();
export type ActionView = z.infer<typeof ActionViewSchema>;

/**
 * Adapter-agnostic, normalized event stream emitted by a {@link CodingAgent}.
 * Raw Codex/tool payloads and transport objects never appear here; adapters
 * translate their own SDK's events into this shape at the boundary.
 */
export const CodingEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thread_ready'), threadId: z.string().min(1) }),
  z.object({ type: z.literal('plan_ready'), actions: z.array(ProposedActionSchema) }),
  z.object({ type: z.literal('message'), text: z.string() }),
  z.object({ type: z.literal('tool_started'), tool: z.string().min(1), summary: z.string() }),
  z.object({
    type: z.literal('tool_finished'),
    tool: z.string().min(1),
    summary: z.string(),
    ok: z.boolean(),
  }),
  z.object({ type: z.literal('completed'), summary: z.string() }),
  z.object({ type: z.literal('failed'), error: TaskErrorProblemSchema }),
]);
export type CodingEvent = z.infer<typeof CodingEventSchema>;

/**
 * Coarse, browser-facing progress phase. Deliberately distinct from
 * {@link TurnStatusSchema}: `understood` marks a confirmed read-only plan
 * (no `queued` phase is ever shown to the browser).
 */
export const ExecutiveUpdatePhaseSchema = z.enum([
  'understood',
  'working',
  'needs_input',
  'completed',
  'failed',
  'cancelled',
]);
export type ExecutiveUpdatePhase = z.infer<typeof ExecutiveUpdatePhaseSchema>;

/** A summarized, non-technical progress update safe to show the user. */
export const ExecutiveUpdateSchema = z.object({
  taskId: id(),
  turnId: id(),
  phase: ExecutiveUpdatePhaseSchema,
  headline: z.string().min(1),
  detail: z.string().optional(),
  createdAt: timestamp(),
});
export type ExecutiveUpdate = z.infer<typeof ExecutiveUpdateSchema>;

/** A pending sensitive-action pause raised by the {@link ActionRiskEvaluator}. */
export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'superseded']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/** Internal durable approval record. */
export const ApprovalRecordSchema = z.object({
  id: id(),
  taskId: id(),
  turnId: id(),
  reason: z.string().min(1),
  actions: z.array(ProposedActionSchema).min(1),
  status: ApprovalStatusSchema,
  createdAt: timestamp(),
  resolvedAt: timestamp().nullable(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

/** Pending approval disclosure safe for browser transports. */
export const ApprovalRequestSchema = z.object({
  id: id(),
  taskId: id(),
  turnId: id(),
  reason: z.string().min(1),
  actions: z.array(ActionViewSchema).min(1),
  createdAt: timestamp(),
}).strict();
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/** Private, technical record of what the agent actually did; never sent to the browser directly. */
export const TechnicalSummarySchema = z.object({
  taskId: id(),
  turnId: id(),
  narrative: z.string(),
  toolsUsed: z.array(z.string()),
  filesTouched: z.array(z.string()),
  createdAt: timestamp(),
});
export type TechnicalSummary = z.infer<typeof TechnicalSummarySchema>;

/**
 * Full server-authoritative task state, returned by `GET /tasks/:id` and
 * loaded before a client resumes the task WebSocket (T3 wraps this with the
 * last event ID it needs for resume).
 */
export const TaskSnapshotSchema = z.object({
  task: TaskViewSchema,
  turns: z.array(TurnSchema),
  updates: z.array(ExecutiveUpdateSchema),
  pendingApproval: ApprovalRequestSchema.nullable(),
});
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;

/** Atomically captured snapshot and its replay cursor. */
export const SnapshotEnvelopeSchema = z.object({
  snapshot: TaskSnapshotSchema,
  lastEventId: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
});
export type SnapshotEnvelope = z.infer<typeof SnapshotEnvelopeSchema>;
