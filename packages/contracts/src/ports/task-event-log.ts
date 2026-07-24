/**
 * One appended, ordered record. `payload` is intentionally opaque here;
 * T3 owns the wire event schemas that populate it.
 */
export interface TaskEventRecord {
  readonly id: string;
  readonly taskId: string;
  readonly createdAt: string;
  readonly payload: unknown;
}

/**
 * Append-only, ordered event log used for WebSocket replay and resync.
 *
 * Demo adapter: bounded in-memory ring buffer per task
 * (`packages/task-store-memory`). Production adapter: a durable,
 * cross-process log (e.g. Postgres table or Kafka topic) so a second
 * client or server restart can still resume from the last event ID.
 */
export interface TaskEventLog {
  append(taskId: string, payload: unknown): Promise<TaskEventRecord>;

  /**
   * Returns events strictly after `afterEventId`, in order. `null` returns
   * the full retained history. Implementations that cannot satisfy replay
   * (e.g. the requested ID fell outside the retention window) reject so
   * the caller can emit `resync_required`.
   */
  listSince(taskId: string, afterEventId: string | null): Promise<TaskEventRecord[]>;

  latestEventId(taskId: string): Promise<string | null>;
}
