import type {
  ActorContext,
  EventLogReadResult,
  ReplayableServerMessage,
  TaskEventLog,
  TaskEventRecord,
} from '@voice-agent/contracts';

import { copy, MemoryTaskState, type MemoryEventStream } from './state.js';

const CANONICAL_EVENT_ID = /^(0|[1-9][0-9]*)$/;

export class MemoryTaskEventLog implements TaskEventLog {
  constructor(private readonly state = new MemoryTaskState()) {}

  async append(
    context: ActorContext,
    taskId: string,
    message: ReplayableServerMessage,
  ): Promise<TaskEventRecord> {
    const key = this.state.streamKey(context.actorId, taskId);
    const stream = this.state.eventStreams.get(key) ?? this.newStream();
    const id = stream.nextId.toString();
    stream.nextId += 1n;
    const record: TaskEventRecord = {
      id,
      taskId,
      createdAt: new Date().toISOString(),
      message: { ...copy(message), eventId: id },
    };
    stream.records.push(record);
    while (stream.records.length > this.state.replayCapacity) {
      const evicted = stream.records.shift();
      if (evicted) stream.retentionFloorEventId = evicted.id;
    }
    this.state.eventStreams.set(key, stream);
    return copy(record);
  }

  async readSince(
    context: ActorContext,
    taskId: string,
    afterEventId: string | null,
  ): Promise<EventLogReadResult> {
    if (afterEventId === null) return { kind: 'replay', events: [] };
    if (!CANONICAL_EVENT_ID.test(afterEventId)) return { kind: 'resync_required' };

    const stream = this.state.eventStreams.get(this.state.streamKey(context.actorId, taskId));
    if (!stream) return { kind: 'resync_required' };

    const index = stream.records.findIndex(({ id }) => id === afterEventId);
    if (index >= 0) {
      return { kind: 'replay', events: copy(stream.records.slice(index + 1)) };
    }
    if (stream.retentionFloorEventId === afterEventId) {
      return { kind: 'replay', events: copy(stream.records) };
    }
    return { kind: 'resync_required' };
  }

  async latestEventId(context: ActorContext, taskId: string): Promise<string | null> {
    const stream = this.state.eventStreams.get(this.state.streamKey(context.actorId, taskId));
    return stream?.records.at(-1)?.id ?? null;
  }

  private newStream(): MemoryEventStream {
    return {
      nextId: 1n,
      retentionFloorEventId: null,
      records: [],
    };
  }
}
