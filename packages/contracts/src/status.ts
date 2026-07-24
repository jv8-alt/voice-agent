import { z } from 'zod';
import { conflictError } from './errors.js';

/**
 * Lifecycle of a task's active turn. `queued` and `working` are active
 * processing states, `needs_input` is a paused active state awaiting
 * approval or follow-up, and `completed`/`failed`/`cancelled` are terminal.
 */
export const TaskStatusSchema = z.enum([
  'queued',
  'working',
  'needs_input',
  'completed',
  'failed',
  'cancelled',
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

const ACTIVE_STATUSES: readonly TaskStatus[] = ['queued', 'working', 'needs_input'];

/**
 * Legal next statuses for each status. Terminal statuses (`completed`,
 * `failed`, `cancelled`) have no legal outbound transitions.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['working', 'cancelled'],
  working: ['needs_input', 'completed', 'failed', 'cancelled'],
  needs_input: ['working', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface TransitionTaskStatusOptions {
  readonly requestId?: string;
}

/**
 * Validates and returns the destination status for a task status
 * transition. Throws a {@link TaskError} with code `conflict` (the frozen
 * "active-turn/invalid-transition conflict" failure category) when the
 * transition is not legal, e.g. `completed -> working` or any transition
 * out of a terminal status.
 */
export function transitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus,
  options: TransitionTaskStatusOptions = {},
): TaskStatus {
  if (!canTransitionTaskStatus(from, to)) {
    const requestId = options.requestId;
    throw conflictError(`Cannot transition task status from "${from}" to "${to}".`, {
      ...(requestId !== undefined ? { requestId } : {}),
      details: { from, to },
    });
  }
  return to;
}
