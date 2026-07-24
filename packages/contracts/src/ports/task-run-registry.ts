export interface ActiveRunHandle {
  readonly taskId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  abort(): void;
}

export interface BeginRunInput {
  readonly taskId: string;
  readonly turnId: string;
}

/**
 * Tracks the single active run per task and owns its `AbortController`, so
 * cancellation is idempotent and overlapping turns on the same task are
 * rejected rather than racing.
 *
 * Demo adapter: an in-memory `Map<taskId, ActiveRunHandle>`
 * (`packages/task-store-memory`). Production adapter: the same in-process
 * pattern, or a distributed lock/registry if the API scales beyond one
 * instance.
 */
export interface TaskRunRegistry {
  /** Registers a new active run. Throws a `conflict` {@link TaskError} if the task already has one. */
  begin(input: BeginRunInput): ActiveRunHandle;

  /** Clears the active run entry once a run reaches a terminal outcome. */
  end(taskId: string): void;

  getActive(taskId: string): ActiveRunHandle | null;

  /** Aborts the active run for a task, if any. Idempotent: returns `false` if there was nothing to cancel. */
  cancel(taskId: string): boolean;
}
