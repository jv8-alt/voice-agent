import {
  runCommandReceiptStoreConformance,
  runTaskEventLogConformance,
  runTaskRunRegistryConformance,
  runTaskStoreConformance,
} from '@voice-agent/contracts/conformance';
import { describe, expect, it } from 'vitest';

import {
  createMemoryTaskAdapters,
  MemoryCommandReceiptStore,
  MemoryTaskEventLog,
  MemoryTaskRunRegistry,
  MemoryTaskState,
  MemoryTaskStore,
} from './index.js';

runTaskStoreConformance(() => new MemoryTaskStore());
runTaskEventLogConformance(() => new MemoryTaskEventLog());
runCommandReceiptStoreConformance(() => new MemoryCommandReceiptStore());
runTaskRunRegistryConformance(() => new MemoryTaskRunRegistry());

const actor = { actorId: 'actor-1' };

function statusMessage(status: 'queued' | 'working' | 'completed') {
  return {
    type: 'turn.status_changed' as const,
    eventId: '0',
    taskId: 'task-1',
    turnId: 'turn-1',
    status,
  };
}

describe('memory adapter integration', () => {
  it('bounds replay and resyncs cursors older than the retained floor', async () => {
    const log = new MemoryTaskEventLog(new MemoryTaskState(2));
    await log.append(actor, 'task-1', statusMessage('queued'));
    await log.append(actor, 'task-1', statusMessage('working'));
    await log.append(actor, 'task-1', statusMessage('completed'));

    await expect(log.readSince(actor, 'task-1', '1')).resolves.toMatchObject({
      kind: 'replay',
      events: [{ id: '2' }, { id: '3' }],
    });
    await expect(log.readSince(actor, 'task-1', '0')).resolves.toEqual({
      kind: 'resync_required',
    });
  });

  it('captures the current event cursor in the task snapshot', async () => {
    const { taskStore, eventLog } = createMemoryTaskAdapters();
    const task = await taskStore.createTask(actor, {
      workspaceId: 'workspace-1',
      title: 'Fix checkout',
    });
    await taskStore.createTurn(actor, {
      taskId: task.id,
      mode: 'typing',
      text: 'Fix it',
    });
    const event = await eventLog.append(actor, task.id, {
      ...statusMessage('queued'),
      taskId: task.id,
    });

    await expect(taskStore.getSnapshot(actor, task.id)).resolves.toMatchObject({
      lastEventId: event.id,
    });
  });

  it('removes aborted runs so a follow-up can start cleanly', () => {
    const registry = new MemoryTaskRunRegistry();
    const first = registry.begin({ taskId: 'task-1', turnId: 'turn-1' });

    expect(registry.cancel('task-1')).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(registry.getActive('task-1')).toBeNull();
    expect(registry.begin({ taskId: 'task-1', turnId: 'turn-2' }).signal.aborted).toBe(false);
  });

  it('does not expose mutable stored command results', async () => {
    const receipts = new MemoryCommandReceiptStore();
    const saved = await receipts.save(actor, {
      commandId: 'command-1',
      payloadFingerprint: 'same',
      result: { cancelled: true },
      createdAt: new Date().toISOString(),
    });
    saved.result.cancelled = false;

    await expect(receipts.get(actor, 'command-1')).resolves.toMatchObject({
      result: { cancelled: true },
    });
  });
});
