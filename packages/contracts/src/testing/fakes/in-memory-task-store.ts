import { randomUUID } from 'node:crypto';
import type { Task, Turn } from '../../domain.js';
import { missingResourceError } from '../../errors.js';
import type { CreateTaskInput, CreateTurnInput, TaskStore } from '../../ports/task-store.js';
import { transitionTaskStatus, type TaskStatus } from '../../status.js';

/**
 * Reference {@link TaskStore} implementation. North star for B2's real
 * `packages/task-store-memory` adapter and the fixture this package's own
 * tests run `runTaskStoreConformance` against. Not a production or demo
 * adapter — see `../../testing/` doc comment for why this stays out of
 * the public barrel.
 */
export class InMemoryFakeTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly turns = new Map<string, Turn>();
  private readonly turnsByTask = new Map<string, string[]>();

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      fixtureId: input.fixtureId,
      title: input.title,
      status: 'queued',
      agentThreadId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.turnsByTask.set(task.id, []);
    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async listTasks(actorId: string): Promise<Task[]> {
    return [...this.tasks.values()].filter((task) => task.actorId === actorId);
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, requestId?: string): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw missingResourceError(`No task with ID "${taskId}".`, requestId !== undefined ? { requestId } : {});
    }
    const nextStatus = transitionTaskStatus(task.status, status, requestId !== undefined ? { requestId } : {});
    const updated: Task = { ...task, status: nextStatus, updatedAt: new Date().toISOString() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async setAgentThreadId(taskId: string, agentThreadId: string): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw missingResourceError(`No task with ID "${taskId}".`);
    }
    const updated: Task = { ...task, agentThreadId, updatedAt: new Date().toISOString() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async createTurn(input: CreateTurnInput): Promise<Turn> {
    if (!this.tasks.has(input.taskId)) {
      throw missingResourceError(`No task with ID "${input.taskId}".`);
    }
    const turn: Turn = {
      id: randomUUID(),
      taskId: input.taskId,
      mode: input.mode,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    this.turns.set(turn.id, turn);
    const ids = this.turnsByTask.get(input.taskId) ?? [];
    ids.push(turn.id);
    this.turnsByTask.set(input.taskId, ids);
    return turn;
  }

  async getTurn(turnId: string): Promise<Turn | null> {
    return this.turns.get(turnId) ?? null;
  }

  async listTurns(taskId: string): Promise<Turn[]> {
    const ids = this.turnsByTask.get(taskId) ?? [];
    return ids.map((id) => {
      const turn = this.turns.get(id);
      if (!turn) {
        throw missingResourceError(`Turn index corrupted for task "${taskId}".`);
      }
      return turn;
    });
  }
}
