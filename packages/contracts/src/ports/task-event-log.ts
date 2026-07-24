import type { ReplayableServerMessage } from '../ws/server-messages.js';
import type { ActorContext } from './actor-context.js';

export interface TaskEventRecord {
  readonly id: string;
  readonly taskId: string;
  readonly createdAt: string;
  readonly message: ReplayableServerMessage;
}

export type EventLogReadResult =
  | { readonly kind: 'replay'; readonly events: TaskEventRecord[] }
  | { readonly kind: 'resync_required' };

/**
 * Append-only, ordered event log used for WebSocket replay and resync.
 *
 * Demo adapter: bounded in-memory ring buffer per task
 * (`packages/task-store-memory`). Production adapter: a durable,
 * cross-process log (e.g. Postgres table or Kafka topic) so a second
 * client or server restart can still resume from the last event ID.
 */
export interface TaskEventLog {
  append(context: ActorContext, taskId: string, message: ReplayableServerMessage): Promise<TaskEventRecord>;

  /**
   * Returns events strictly after `afterEventId`, in order. `null` is a fresh
   * subscription and returns no replay because the caller sends an atomic
   * snapshot. Unknown or evicted cursors return `resync_required`.
   */
  readSince(context: ActorContext, taskId: string, afterEventId: string | null): Promise<EventLogReadResult>;

  latestEventId(context: ActorContext, taskId: string): Promise<string | null>;
}
