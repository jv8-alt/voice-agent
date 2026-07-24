import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskEventLog } from '../ports/task-event-log.js';

/**
 * Conformance suite for {@link TaskEventLog}. Covers the invariants this
 * port is directly responsible for: append-order preservation, correct
 * `listSince` slicing (the primitive the replay policy in
 * `../replay/plan-replay.ts` is built on), and `latestEventId` tracking.
 */
export function runTaskEventLogConformance(createLog: () => TaskEventLog | Promise<TaskEventLog>): void {
  describe('TaskEventLog conformance', () => {
    let log: TaskEventLog;
    const taskId = 'task-1';

    beforeEach(async () => {
      log = await createLog();
    });

    it('returns null for latestEventId on a task with no events', async () => {
      await expect(log.latestEventId(taskId)).resolves.toBeNull();
    });

    it('returns an empty list from listSince(null) on a task with no events', async () => {
      await expect(log.listSince(taskId, null)).resolves.toEqual([]);
    });

    it('appends events with strictly increasing IDs, in append order', async () => {
      const first = await log.append(taskId, { seq: 1 });
      const second = await log.append(taskId, { seq: 2 });
      const third = await log.append(taskId, { seq: 3 });

      expect(new Set([first.id, second.id, third.id]).size).toBe(3);

      const all = await log.listSince(taskId, null);
      expect(all.map((record) => record.payload)).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
      expect(all.map((record) => record.id)).toEqual([first.id, second.id, third.id]);
    });

    it('listSince(afterEventId) returns only events strictly after that ID', async () => {
      const first = await log.append(taskId, { seq: 1 });
      const second = await log.append(taskId, { seq: 2 });
      const third = await log.append(taskId, { seq: 3 });

      const afterFirst = await log.listSince(taskId, first.id);
      expect(afterFirst.map((record) => record.id)).toEqual([second.id, third.id]);

      const afterLast = await log.listSince(taskId, third.id);
      expect(afterLast).toEqual([]);
    });

    it('tracks latestEventId as the most recently appended event', async () => {
      await log.append(taskId, { seq: 1 });
      const second = await log.append(taskId, { seq: 2 });
      await expect(log.latestEventId(taskId)).resolves.toBe(second.id);
    });

    it('keeps event streams isolated per task', async () => {
      const otherTaskId = 'task-2';
      const own = await log.append(taskId, { seq: 1 });
      await log.append(otherTaskId, { seq: 'other' });

      const events = await log.listSince(taskId, null);
      expect(events.map((record) => record.id)).toEqual([own.id]);
      expect(events.every((record) => record.taskId === taskId)).toBe(true);
    });
  });
}
