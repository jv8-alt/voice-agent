import { z } from 'zod';
import { conflictError } from './errors.js';

/**
 * Lifecycle of one turn. `queued` and `working` are active
 * processing states, `needs_input` is a paused active state awaiting
 * approval or follow-up, and `completed`/`failed`/`cancelled` are terminal.
 */
export const TurnStatusSchema = z.enum([
  'queued',
  'working',
  'needs_input',
  'completed',
  'failed',
  'cancelled',
]);

export type TurnStatus = z.infer<typeof TurnStatusSchema>;

const ACTIVE_STATUSES: readonly TurnStatus[] = ['queued', 'working', 'needs_input'];

/**
 * Legal next statuses for each status. Terminal statuses (`completed`,
 * `failed`, `cancelled`) have no legal outbound transitions.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TurnStatus, readonly TurnStatus[]>> = {
  queued: ['working', 'cancelled'],
  working: ['needs_input', 'completed', 'failed', 'cancelled'],
  needs_input: ['working', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isActiveTurnStatus(status: TurnStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function canTransitionTurnStatus(from: TurnStatus, to: TurnStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface TransitionTurnStatusOptions {
  readonly requestId?: string;
}

/**
 * Validates and returns the destination status for a task status
 * transition. Throws a {@link TaskError} with code `conflict` (the frozen
 * "active-turn/invalid-transition conflict" failure category) when the
 * transition is not legal, e.g. `completed -> working` or any transition
 * out of a terminal status.
 */
export function transitionTurnStatus(
  from: TurnStatus,
  to: TurnStatus,
  options: TransitionTurnStatusOptions = {},
): TurnStatus {
  if (!canTransitionTurnStatus(from, to)) {
    const requestId = options.requestId;
    throw conflictError(`Cannot transition turn status from "${from}" to "${to}".`, {
      ...(requestId !== undefined ? { requestId } : {}),
      details: { from, to },
    });
  }
  return to;
}
