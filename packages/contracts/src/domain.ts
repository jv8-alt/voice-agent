import { z } from 'zod';
import { TaskErrorProblemSchema } from './errors.js';
import { TaskStatusSchema } from './status.js';

/** How a turn's input was captured. Voice (`ptt`/`handsfree`) is the demo's primary path; `typing` is a functional fallback. */
export const TurnModeSchema = z.enum(['ptt', 'handsfree', 'typing']);
export type TurnMode = z.infer<typeof TurnModeSchema>;

const timestamp = () => z.string().datetime();
const id = () => z.string().min(1);

/**
 * A unit of work created on a fixture workspace. One Codex thread is
 * reused across a task's turns; `agentThreadId` is unset until the first
 * `CodingAgent.plan()` call establishes it.
 */
export const TaskSchema = z.object({
  id: id(),
  actorId: id(),
  workspaceId: id(),
  fixtureId: id(),
  title: z.string().min(1),
  status: TaskStatusSchema,
  agentThreadId: z.string().min(1).nullable(),
  createdAt: timestamp(),
  updatedAt: timestamp(),
});
export type Task = z.infer<typeof TaskSchema>;

/** One user submission (voice or typed) within a task. */
export const TurnSchema = z.object({
  id: id(),
  taskId: id(),
  mode: TurnModeSchema,
  text: z.string().min(1),
  createdAt: timestamp(),
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
 * {@link TaskStatusSchema}: `understood` marks a confirmed read-only plan
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
export const ApprovalRequestSchema = z.object({
  id: id(),
  taskId: id(),
  turnId: id(),
  reason: z.string().min(1),
  actions: z.array(ProposedActionSchema).min(1),
  createdAt: timestamp(),
});
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
  task: TaskSchema,
  turns: z.array(TurnSchema),
  updates: z.array(ExecutiveUpdateSchema),
  pendingApproval: ApprovalRequestSchema.nullable(),
});
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
