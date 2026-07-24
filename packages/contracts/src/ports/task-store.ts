import type {
  ApprovalRecord,
  ExecutiveUpdate,
  SnapshotEnvelope,
  TaskRecord,
  TaskView,
  Turn,
  TurnMode,
} from '../domain.js';
import type { TurnStatus } from '../status.js';
import type { ActorContext } from './actor-context.js';

export interface CreateTaskInput {
  readonly workspaceId: string;
  readonly title: string;
}

export interface CreateTurnInput {
  readonly taskId: string;
  readonly mode: TurnMode;
  readonly text: string;
}

/**
 * Persists tasks and turns and enforces legal status transitions.
 *
 * Demo adapter: process-local in-memory map (`packages/task-store-memory`).
 * Production adapter: Postgres-backed store keyed by the same stable IDs.
 */
export interface TaskStore {
  createTask(context: ActorContext, input: CreateTaskInput): Promise<TaskRecord>;
  getTask(context: ActorContext, taskId: string): Promise<TaskRecord | null>;
  listTasks(context: ActorContext): Promise<TaskView[]>;

  /**
   * Applies a status transition via {@link transitionTurnStatus} and
   * persists the result. Throws the same `conflict` {@link TaskError} for
   * an illegal transition.
   */
  updateTurnStatus(context: ActorContext, turnId: string, status: TurnStatus, requestId?: string): Promise<Turn>;

  /** Records the agent thread established by the first `CodingAgent.plan()` call for a task. */
  setAgentThreadId(context: ActorContext, taskId: string, agentThreadId: string): Promise<TaskRecord>;

  createTurn(context: ActorContext, input: CreateTurnInput): Promise<Turn>;
  getTurn(context: ActorContext, turnId: string): Promise<Turn | null>;
  listTurns(context: ActorContext, taskId: string): Promise<Turn[]>;
  appendUpdate(context: ActorContext, update: ExecutiveUpdate): Promise<void>;
  saveApproval(context: ActorContext, approval: ApprovalRecord): Promise<ApprovalRecord>;
  resolveApproval(
    context: ActorContext,
    approvalId: string,
    status: 'approved' | 'rejected' | 'superseded',
  ): Promise<ApprovalRecord>;
  getSnapshot(context: ActorContext, taskId: string): Promise<SnapshotEnvelope | null>;
}
