import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../ws/server-messages.js';
import { planReplay, type ReplayableEvent } from './plan-replay.js';

function statusChanged(eventId: string, taskId = 'task-1'): ReplayableEvent {
  const message: ServerMessage = {
    type: 'task.status_changed',
    eventId,
    taskId,
    status: 'working',
  };
  return { eventId, message };
}

const events: ReplayableEvent[] = [statusChanged('1'), statusChanged('2'), statusChanged('3')];

function eventIdsOf(messages: ServerMessage[]): string[] {
  return messages.map((message) => {
    if (!('eventId' in message)) {
      throw new Error(`Expected message to carry an eventId, got: ${JSON.stringify(message)}`);
    }
    return message.eventId;
  });
}

describe('planReplay', () => {
  it('replays nothing extra for a fresh subscribe (afterEventId null)', () => {
    const result = planReplay({
      requestedAfterEventId: null,
      availableEvents: events,
      retentionFloorEventId: null,
    });
    expect(result).toEqual({ kind: 'replay', events: [] });
  });

  it('replays events strictly after a known cursor', () => {
    const result = planReplay({
      requestedAfterEventId: '1',
      availableEvents: events,
      retentionFloorEventId: null,
    });
    expect(result.kind).toBe('replay');
    expect(result.kind === 'replay' ? eventIdsOf(result.events) : []).toEqual(['2', '3']);
  });

  it('replays an empty list when the client is already caught up to the latest event', () => {
    const result = planReplay({
      requestedAfterEventId: '3',
      availableEvents: events,
      retentionFloorEventId: null,
    });
    expect(result).toEqual({ kind: 'replay', events: [] });
  });

  it('replays the entire retained window when the cursor equals the retention floor', () => {
    const result = planReplay({
      requestedAfterEventId: '0',
      availableEvents: events,
      retentionFloorEventId: '0',
    });
    expect(result.kind).toBe('replay');
    expect(result.kind === 'replay' ? eventIdsOf(result.events) : []).toEqual(['1', '2', '3']);
  });

  it('requires resync when the cursor predates the retention floor', () => {
    const result = planReplay({
      requestedAfterEventId: '1',
      availableEvents: events.slice(1),
      retentionFloorEventId: '2',
    });
    expect(result).toEqual({ kind: 'resync_required' });
  });

  it('requires resync for an unknown cursor with no retention floor recorded', () => {
    const result = planReplay({
      requestedAfterEventId: '999',
      availableEvents: [],
      retentionFloorEventId: null,
    });
    expect(result).toEqual({ kind: 'resync_required' });
  });

  it('requires resync for a cursor ahead of every retained event', () => {
    const result = planReplay({
      requestedAfterEventId: '999',
      availableEvents: events,
      retentionFloorEventId: '0',
    });
    expect(result).toEqual({ kind: 'resync_required' });
  });

  it('replays the full history when nothing has ever been evicted and the cursor is unknown but not older than any retained event', () => {
    // No floor recorded (nothing evicted) but the cursor does not match any
    // retained event and is not the floor itself: still resync, since the
    // log cannot prove the cursor is genuinely this task's own history.
    const result = planReplay({
      requestedAfterEventId: '5',
      availableEvents: events,
      retentionFloorEventId: null,
    });
    expect(result).toEqual({ kind: 'resync_required' });
  });

  it('treats an empty retained window with a matching floor as fully caught up', () => {
    const result = planReplay({
      requestedAfterEventId: '3',
      availableEvents: [],
      retentionFloorEventId: '3',
    });
    expect(result).toEqual({ kind: 'replay', events: [] });
  });
});
