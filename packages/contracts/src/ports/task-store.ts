import type { Task, Turn, TurnMode } from '../domain.js';
import type { TaskStatus } from '../status.js';

export interface CreateTaskInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly fixtureId: string;
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
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(actorId: string): Promise<Task[]>;

  /**
   * Applies a status transition via {@link transitionTaskStatus} and
   * persists the result. Throws the same `conflict` {@link TaskError} for
   * an illegal transition.
   */
  updateTaskStatus(taskId: string, status: TaskStatus, requestId?: string): Promise<Task>;

  /** Records the agent thread established by the first `CodingAgent.plan()` call for a task. */
  setAgentThreadId(taskId: string, agentThreadId: string): Promise<Task>;

  createTurn(input: CreateTurnInput): Promise<Turn>;
  getTurn(turnId: string): Promise<Turn | null>;
  listTurns(taskId: string): Promise<Turn[]>;
}
