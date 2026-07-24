import { beforeEach, describe, expect, it } from 'vitest';
import type { ActorContext } from '../ports/actor-context.js';
import type { TaskEventLog } from '../ports/task-event-log.js';
import type { ReplayableServerMessage } from '../ws/server-messages.js';

const actor: ActorContext = { actorId: 'actor-1' };
const otherActor: ActorContext = { actorId: 'actor-2' };

function message(status: 'queued' | 'working' | 'completed'): ReplayableServerMessage {
  return {
    type: 'turn.status_changed',
    eventId: '0',
    taskId: 'task-1',
    turnId: 'turn-1',
    status,
  };
}

export function runTaskEventLogConformance(createLog: () => TaskEventLog | Promise<TaskEventLog>): void {
  describe('TaskEventLog conformance', () => {
    let log: TaskEventLog;

    beforeEach(async () => {
      log = await createLog();
    });

    it('mints canonical numeric IDs and replays in numeric order', async () => {
      for (let index = 0; index < 12; index += 1) {
        await log.append(actor, 'task-1', message(index === 0 ? 'queued' : 'working'));
      }
      const result = await log.readSince(actor, 'task-1', '9');
      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') expect(result.events.map(({ id }) => id)).toEqual(['10', '11', '12']);
    });

    it('returns resync_required for unknown cursors', async () => {
      await log.append(actor, 'task-1', message('queued'));
      await expect(log.readSince(actor, 'task-1', '999')).resolves.toEqual({ kind: 'resync_required' });
    });

    it('replays nothing for a fresh subscription because a snapshot is sent', async () => {
      await log.append(actor, 'task-1', message('queued'));
      await expect(log.readSince(actor, 'task-1', null)).resolves.toEqual({ kind: 'replay', events: [] });
    });

    it('isolates streams by actor and task', async () => {
      await log.append(actor, 'task-1', message('queued'));
      await expect(log.latestEventId(otherActor, 'task-1')).resolves.toBeNull();
      await expect(log.readSince(otherActor, 'task-1', null)).resolves.toEqual({
        kind: 'replay',
        events: [],
      });
    });
  });
}
