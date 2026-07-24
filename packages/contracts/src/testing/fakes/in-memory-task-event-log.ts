import { invalidInputError } from '../../errors.js';
import type { TaskEventLog, TaskEventRecord } from '../../ports/task-event-log.js';

/**
 * Reference {@link TaskEventLog} implementation: an unbounded per-task
 * array with a monotonically increasing, per-task decimal-string counter
 * matching the `EventId` format pinned in `../../ws/event-id.ts`. North
 * star for B2's real bounded ring-buffer adapter, which additionally
 * needs to evict old entries and reject `listSince` for evicted IDs (see
 * `../../replay/plan-replay.ts` for how a gateway turns that rejection
 * into `resync_required`).
 */
export class InMemoryFakeTaskEventLog implements TaskEventLog {
  private readonly recordsByTask = new Map<string, TaskEventRecord[]>();
  private readonly countersByTask = new Map<string, number>();

  async append(taskId: string, payload: unknown): Promise<TaskEventRecord> {
    const nextSeq = (this.countersByTask.get(taskId) ?? 0) + 1;
    this.countersByTask.set(taskId, nextSeq);

    const record: TaskEventRecord = {
      id: String(nextSeq),
      taskId,
      createdAt: new Date().toISOString(),
      payload,
    };
    const records = this.recordsByTask.get(taskId) ?? [];
    records.push(record);
    this.recordsByTask.set(taskId, records);
    return record;
  }

  async listSince(taskId: string, afterEventId: string | null): Promise<TaskEventRecord[]> {
    const records = this.recordsByTask.get(taskId) ?? [];
    if (afterEventId === null) {
      return [...records];
    }
    const index = records.findIndex((record) => record.id === afterEventId);
    if (index === -1) {
      // This fake never evicts, so an unrecognized ID is malformed input,
      // not a retention-window miss. Real bounded adapters (B2) reject
      // for the retention case too; a gateway turns either rejection into
      // `resync_required` (see `../../replay/plan-replay.ts`).
      throw invalidInputError(`No event "${afterEventId}" for task "${taskId}".`);
    }
    return records.slice(index + 1);
  }

  async latestEventId(taskId: string): Promise<string | null> {
    const records = this.recordsByTask.get(taskId) ?? [];
    return records.at(-1)?.id ?? null;
  }
}
