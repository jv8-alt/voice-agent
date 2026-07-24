import type { EventId } from '../ws/event-id.js';
import { compareEventIds } from '../ws/event-id.js';
import type { ReplayableServerMessage } from '../ws/server-messages.js';

/** One retained event available for replay, keyed by its wire {@link EventId}. */
export interface ReplayableEvent {
  readonly eventId: EventId;
  readonly message: ReplayableServerMessage;
}

export interface PlanReplayInput {
  /**
   * The client's last-seen `eventId`, or `null` for a fresh subscription.
   */
  readonly requestedAfterEventId: EventId | null;
  /**
   * All events currently retained for the task, oldest first, with no
   * gaps. This is the log's *actual* retained window — it may be shorter
   * than the task's full history if the adapter bounds retention.
   */
  readonly availableEvents: readonly ReplayableEvent[];
  /**
   * The oldest `eventId` the log can still serve a request for (i.e. the
   * smallest legal `requestedAfterEventId`), or `null` if the log has
   * never evicted anything and can serve any prior cursor. This is
   * typically, but not necessarily, `availableEvents[0].eventId` — an
   * adapter may set it one position "before" the oldest retained event
   * to mean "requesting after this ID replays the entire retained
   * window."
   */
  readonly retentionFloorEventId: EventId | null;
}

export type PlanReplayResult =
  | { readonly kind: 'replay'; readonly events: ReplayableServerMessage[] }
  | { readonly kind: 'resync_required' };

/**
 * Pure replay/resync decision function per MIKADO.md's design decision
 * ("monotonic event IDs, heartbeat, bounded replay, and `resync_required`
 * when replay is unavailable"). This is intentionally not a server or a
 * `TaskEventLog` implementation — B2 owns the real adapter that stores
 * events and enforces retention; this function only decides, given a
 * requested cursor and whatever window an adapter reports, what a
 * WebSocket gateway (F2) or the `GET /tasks/:id/events` REST fallback
 * should send back.
 *
 * Pinned rules:
 * 1. `requestedAfterEventId === null` → fresh subscribe. Replays nothing
 *    extra: the caller is expected to have already sent (or to send) a
 *    `task.snapshot`, which carries full current state. Replaying the
 *    entire history here would duplicate that snapshot's information.
 * 2. Otherwise, if `retentionFloorEventId` is set and the requested
 *    cursor is strictly older (by {@link compareEventIds}) than the
 *    floor, the log can no longer prove it has every event after that
 *    cursor → `resync_required`.
 * 3. Otherwise, if the requested cursor exactly matches
 *    `retentionFloorEventId`, replay the *entire* retained window (every
 *    event in `availableEvents`), since the floor is defined as the
 *    oldest cursor the log can serve from.
 * 4. Otherwise, look up the requested cursor inside `availableEvents`. If
 *    found, replay the ordered slice strictly after it (this also
 *    correctly returns an empty replay when the cursor is the newest
 *    retained event — the client is already caught up).
 * 5. Otherwise the cursor is unknown to the log (neither retained nor
 *    equal to the floor) — most likely a stale ID from a restarted
 *    process or a different task's stream — so the safe default is
 *    `resync_required` rather than guessing.
 */
export function planReplay(input: PlanReplayInput): PlanReplayResult {
  const { requestedAfterEventId, availableEvents, retentionFloorEventId } = input;

  if (requestedAfterEventId === null) {
    return { kind: 'replay', events: [] };
  }

  if (
    retentionFloorEventId !== null &&
    compareEventIds(requestedAfterEventId, retentionFloorEventId) < 0
  ) {
    return { kind: 'resync_required' };
  }

  const index = availableEvents.findIndex((event) => event.eventId === requestedAfterEventId);

  if (index === -1) {
    if (retentionFloorEventId !== null && requestedAfterEventId === retentionFloorEventId) {
      return { kind: 'replay', events: availableEvents.map((event) => event.message) };
    }
    return { kind: 'resync_required' };
  }

  return { kind: 'replay', events: availableEvents.slice(index + 1).map((event) => event.message) };
}
