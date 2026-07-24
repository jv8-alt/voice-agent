import { z } from 'zod';

/**
 * Wire format for a task event's position in its per-task stream.
 *
 * Design choice (T3): an `eventId` is the base-10 string form of a
 * per-task, monotonically increasing unsigned integer counter minted by
 * whichever {@link TaskEventLog} appends the event (e.g. `"1"`, `"2"`,
 * `"42"`). A string (not a `number`) avoids IEEE-754 precision loss for
 * long-running demo processes and keeps the wire format identical to
 * {@link TaskEventRecord.id} in `../ports/task-event-log.ts`, so an
 * adapter can use the same value for both without translation.
 *
 * IDs are only ever compared *within* one task's stream; they are not
 * globally ordered across tasks. {@link compareEventIds} is the pinned
 * comparison so every adapter and the replay policy in `../replay/`
 * agree on ordering.
 */
export const EventIdSchema = z
  .string()
  .regex(/^[0-9]+$/, 'eventId must be a base-10 non-negative integer string');
export type EventId = z.infer<typeof EventIdSchema>;

/** Pinned ordering for {@link EventId} values: numeric, not lexicographic. */
export function compareEventIds(a: EventId, b: EventId): number {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
