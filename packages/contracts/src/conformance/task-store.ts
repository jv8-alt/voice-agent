import { beforeEach, describe, expect, it } from 'vitest';
import { TaskError } from '../errors.js';
import type { CreateTaskInput, TaskStore } from '../ports/task-store.js';

const baseTask: CreateTaskInput = {
  actorId: 'demo-user',
  workspaceId: 'workspace-1',
  fixtureId: 'checkout-regression',
  title: 'Fix the checkout bug',
};

/**
 * Conformance suite for {@link TaskStore}. Covers the invariants pinned in
 * MIKADO.md's "Contract tests cover..." that are this port's
 * responsibility: invalid status transitions and missing-ID lookups.
 * (Overlapping/duplicate active turns are `TaskRunRegistry`'s invariant —
 * see `./task-run-registry.ts` — since `TaskStore` itself has no
 * "one active run" rule in its T2 contract.)
 */
export function runTaskStoreConformance(createStore: () => TaskStore | Promise<TaskStore>): void {
  describe('TaskStore conformance', () => {
    let store: TaskStore;

    beforeEach(async () => {
      store = await createStore();
    });

    it('creates a task in the initial "queued" status', async () => {
      const task = await store.createTask(baseTask);
      expect(task.status).toBe('queued');
      expect(task.actorId).toBe(baseTask.actorId);
      expect(task.agentThreadId).toBeNull();
      expect(task.id.length).toBeGreaterThan(0);
    });

    it('returns null for a missing task ID', async () => {
      await expect(store.getTask('does-not-exist')).resolves.toBeNull();
    });

    it('returns null for a missing turn ID', async () => {
      await expect(store.getTurn('does-not-exist')).resolves.toBeNull();
    });

    it('lists only tasks belonging to the requested actor', async () => {
      const mine = await store.createTask(baseTask);
      await store.createTask({ ...baseTask, actorId: 'someone-else' });

      const tasks = await store.listTasks(baseTask.actorId);
      expect(tasks.map((task) => task.id)).toEqual([mine.id]);
    });

    it('applies a legal status transition and persists it', async () => {
      const task = await store.createTask(baseTask);
      const updated = await store.updateTaskStatus(task.id, 'working');
      expect(updated.status).toBe('working');

      const reloaded = await store.getTask(task.id);
      expect(reloaded?.status).toBe('working');
    });

    it('rejects an illegal status transition with a "conflict" TaskError', async () => {
      const task = await store.createTask(baseTask);
      await store.updateTaskStatus(task.id, 'working');
      await store.updateTaskStatus(task.id, 'completed');

      let caught: unknown;
      try {
        await store.updateTaskStatus(task.id, 'working');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaskError);
      expect((caught as TaskError).code).toBe('conflict');
    });

    it('rejects a status transition for a missing task ID', async () => {
      let caught: unknown;
      try {
        await store.updateTaskStatus('does-not-exist', 'working');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TaskError);
      expect((caught as TaskError).code).toBe('not_found');
    });

    it('records the agent thread ID established by the first plan() call', async () => {
      const task = await store.createTask(baseTask);
      const updated = await store.setAgentThreadId(task.id, 'thread-1');
      expect(updated.agentThreadId).toBe('thread-1');

      const reloaded = await store.getTask(task.id);
      expect(reloaded?.agentThreadId).toBe('thread-1');
    });

    it('creates and lists turns for a task in creation order', async () => {
      const task = await store.createTask(baseTask);
      const first = await store.createTurn({ taskId: task.id, mode: 'ptt', text: 'Fix the bug' });
      const second = await store.createTurn({ taskId: task.id, mode: 'typing', text: 'Also add a test' });

      const turns = await store.listTurns(task.id);
      expect(turns.map((turn) => turn.id)).toEqual([first.id, second.id]);
    });
  });
}
