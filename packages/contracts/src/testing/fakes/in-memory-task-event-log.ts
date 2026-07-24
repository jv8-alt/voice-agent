import type { ActorContext } from '../../ports/actor-context.js';
import type {
  EventLogReadResult,
  TaskEventLog,
  TaskEventRecord,
} from '../../ports/task-event-log.js';
import type { ReplayableServerMessage } from '../../ws/server-messages.js';

export class InMemoryFakeTaskEventLog implements TaskEventLog {
  private readonly records = new Map<string, TaskEventRecord[]>();

  private key(context: ActorContext, taskId: string): string {
    return `${context.actorId}\0${taskId}`;
  }

  async append(
    context: ActorContext,
    taskId: string,
    message: ReplayableServerMessage,
  ): Promise<TaskEventRecord> {
    const key = this.key(context, taskId);
    const stream = this.records.get(key) ?? [];
    const id = String(stream.length + 1);
    const record: TaskEventRecord = {
      id,
      taskId,
      createdAt: new Date().toISOString(),
      message: { ...message, eventId: id },
    };
    stream.push(record);
    this.records.set(key, stream);
    return record;
  }

  async readSince(
    context: ActorContext,
    taskId: string,
    afterEventId: string | null,
  ): Promise<EventLogReadResult> {
    const stream = this.records.get(this.key(context, taskId)) ?? [];
    if (afterEventId === null) return { kind: 'replay', events: [] };
    const index = stream.findIndex(({ id }) => id === afterEventId);
    return index < 0
      ? { kind: 'resync_required' }
      : { kind: 'replay', events: stream.slice(index + 1) };
  }

  async latestEventId(context: ActorContext, taskId: string): Promise<string | null> {
    return this.records.get(this.key(context, taskId))?.at(-1)?.id ?? null;
  }
}
