import { beforeEach, describe, expect, it } from 'vitest';
import { TaskError } from '../errors.js';
import type { TaskRunRegistry } from '../ports/task-run-registry.js';

/**
 * Conformance suite for {@link TaskRunRegistry}. Covers this port's
 * pinned invariants: overlapping turns on the same task are rejected
 * (not raced), and cancel/end are idempotent.
 */
export function runTaskRunRegistryConformance(
  createRegistry: () => TaskRunRegistry | Promise<TaskRunRegistry>,
): void {
  describe('TaskRunRegistry conformance', () => {
    let registry: TaskRunRegistry;
    const taskId = 'task-1';

    beforeEach(async () => {
      registry = await createRegistry();
    });

    it('returns null for a task with no active run', () => {
      expect(registry.getActive(taskId)).toBeNull();
    });

    it('begin() registers an active run retrievable via getActive()', () => {
      const handle = registry.begin({ taskId, turnId: 'turn-1' });
      expect(registry.getActive(taskId)).toBe(handle);
      expect(handle.signal.aborted).toBe(false);
    });

    it('rejects a second concurrent run on the same task with a "conflict" TaskError', () => {
      registry.begin({ taskId, turnId: 'turn-1' });

      let caught: unknown;
      try {
        registry.begin({ taskId, turnId: 'turn-2' });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaskError);
      expect((caught as TaskError).code).toBe('conflict');
    });

    it('allows a new run once the previous one has ended', () => {
      registry.begin({ taskId, turnId: 'turn-1' });
      registry.end(taskId);
      expect(registry.getActive(taskId)).toBeNull();

      const second = registry.begin({ taskId, turnId: 'turn-2' });
      expect(registry.getActive(taskId)).toBe(second);
    });

    it('cancel() aborts the active run and returns true exactly once', () => {
      const handle = registry.begin({ taskId, turnId: 'turn-1' });
      expect(registry.cancel(taskId)).toBe(true);
      expect(handle.signal.aborted).toBe(true);
    });

    it('cancel() is idempotent: false when there is nothing to cancel', () => {
      expect(registry.cancel(taskId)).toBe(false);

      registry.begin({ taskId, turnId: 'turn-1' });
      expect(registry.cancel(taskId)).toBe(true);
      expect(registry.cancel(taskId)).toBe(false);
    });

    it('keeps active runs isolated per task', () => {
      const first = registry.begin({ taskId: 'task-a', turnId: 'turn-1' });
      const second = registry.begin({ taskId: 'task-b', turnId: 'turn-2' });

      expect(registry.getActive('task-a')).toBe(first);
      expect(registry.getActive('task-b')).toBe(second);
      expect(registry.cancel('task-a')).toBe(true);
      expect(registry.getActive('task-b')).toBe(second);
      expect(second.signal.aborted).toBe(false);
    });
  });
}
