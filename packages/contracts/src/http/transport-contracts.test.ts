import { describe, expect, it } from 'vitest';
import { CreateTaskRequestSchema, GetTaskEventsQuerySchema } from './tasks.js';
import { InMemoryFakeTaskEventLog } from '../testing/fakes/in-memory-task-event-log.js';
import {
  ClientMessageSchema,
  ReplayableServerMessageSchema,
  ServerMessageSchema,
  compareEventIds,
} from '../ws/index.js';

describe('transport contracts', () => {
  it('strictly rejects malformed commands and requires snapshot cursors', () => {
    expect(ClientMessageSchema.safeParse({
      type: 'task.subscribe',
      taskId: 'task-1',
      afterEventId: null,
      extra: true,
    }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'task.subscribe', taskId: 'task-1' }).success).toBe(false);
    expect(GetTaskEventsQuerySchema.safeParse({}).success).toBe(false);
  });

  it('keeps repository selection out of create-task requests', () => {
    expect(CreateTaskRequestSchema.safeParse({
      fixtureId: 'private-fixture',
      title: 'Fix checkout',
      turn: { mode: 'typing', text: 'Fix it' },
    }).success).toBe(false);
    const parsed = CreateTaskRequestSchema.parse({
      title: 'Fix checkout',
      turn: { mode: 'typing', text: 'Fix it' },
    });
    expect(parsed).not.toHaveProperty('fixtureId');
  });

  it('prevents snapshots, errors, and connection messages from entering replay logs', () => {
    for (const message of [
      { type: 'connection.ready', connectionId: 'connection-1' },
      { type: 'resync_required', taskId: 'task-1' },
      {
        type: 'error',
        error: { code: 'conflict', message: 'stale', retryable: false, requestId: 'request-1' },
      },
    ]) {
      expect(ServerMessageSchema.safeParse(message).success).toBe(true);
      expect(ReplayableServerMessageSchema.safeParse(message).success).toBe(false);
    }
  });

  it('echoes successful command IDs and orders event IDs numerically', () => {
    expect(ServerMessageSchema.safeParse({
      type: 'approval.resolved',
      eventId: '10',
      taskId: 'task-1',
      approvalId: 'approval-1',
      decision: 'approve',
      commandId: 'command-1',
    }).success).toBe(true);
    expect(compareEventIds('10', '9')).toBeGreaterThan(0);
    expect(ServerMessageSchema.safeParse({
      type: 'turn.status_changed',
      eventId: '01',
      taskId: 'task-1',
      turnId: 'turn-1',
      status: 'working',
    }).success).toBe(false);
  });

  it('continues replay strictly after an atomically captured snapshot cursor', async () => {
    const actor = { actorId: 'actor-1' };
    const log = new InMemoryFakeTaskEventLog();
    const base = {
      type: 'turn.status_changed' as const,
      eventId: '0',
      taskId: 'task-1',
      turnId: 'turn-1',
    };
    const beforeSnapshot = await log.append(actor, 'task-1', { ...base, status: 'queued' });
    const snapshotCursor = beforeSnapshot.id;
    const afterSnapshot = await log.append(actor, 'task-1', { ...base, status: 'working' });

    const replay = await log.readSince(actor, 'task-1', snapshotCursor);
    expect(replay).toEqual({ kind: 'replay', events: [afterSnapshot] });
  });
});
