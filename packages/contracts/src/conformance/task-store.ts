import { beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalRecord } from '../domain.js';
import { TaskError } from '../errors.js';
import type { ActorContext } from '../ports/actor-context.js';
import type { CreateTaskInput, TaskStore } from '../ports/task-store.js';

const actor: ActorContext = { actorId: 'actor-1' };
const otherActor: ActorContext = { actorId: 'actor-2' };
const baseTask: CreateTaskInput = { workspaceId: 'workspace-1', title: 'Fix checkout' };

export function runTaskStoreConformance(createStore: () => TaskStore | Promise<TaskStore>): void {
  describe('TaskStore conformance', () => {
    let store: TaskStore;

    beforeEach(async () => {
      store = await createStore();
    });

    async function createTaskAndTurn() {
      const task = await store.createTask(actor, baseTask);
      const turn = await store.createTurn(actor, { taskId: task.id, mode: 'ptt', text: 'Fix it' });
      return { task, turn };
    }

    it('hides every lookup from the wrong actor as not_found', async () => {
      const { task, turn } = await createTaskAndTurn();
      await expect(store.getTask(otherActor, task.id)).resolves.toBeNull();
      await expect(store.getTurn(otherActor, turn.id)).resolves.toBeNull();
      await expect(store.getSnapshot(otherActor, task.id)).resolves.toBeNull();
      await expect(store.listTasks(otherActor)).resolves.toEqual([]);
    });

    it('derives a task view from the latest turn', async () => {
      const { task, turn } = await createTaskAndTurn();
      await store.updateTurnStatus(actor, turn.id, 'working');
      const [view] = await store.listTasks(actor);
      expect(view).toMatchObject({ id: task.id, status: 'working' });
      expect(view).not.toHaveProperty('actorId');
      expect(view).not.toHaveProperty('agentThreadId');
    });

    it('allows a queued follow-up after a terminal turn without mutating it', async () => {
      const { task, turn } = await createTaskAndTurn();
      await store.updateTurnStatus(actor, turn.id, 'working');
      const terminal = await store.updateTurnStatus(actor, turn.id, 'completed');
      const followUp = await store.createTurn(actor, { taskId: task.id, mode: 'typing', text: 'Add tests' });
      expect(followUp.status).toBe('queued');
      expect(await store.getTurn(actor, turn.id)).toEqual(terminal);
    });

    it('rejects overlapping active turns and illegal terminal transitions', async () => {
      const { task, turn } = await createTaskAndTurn();
      await expect(
        store.createTurn(actor, { taskId: task.id, mode: 'typing', text: 'Overlap' }),
      ).rejects.toMatchObject({ code: 'conflict' });
      await store.updateTurnStatus(actor, turn.id, 'working');
      await store.updateTurnStatus(actor, turn.id, 'cancelled');
      await expect(store.updateTurnStatus(actor, turn.id, 'working')).rejects.toBeInstanceOf(TaskError);
    });

    it('persists approvals and rejects stale resolution', async () => {
      const { task, turn } = await createTaskAndTurn();
      await store.updateTurnStatus(actor, turn.id, 'working');
      await store.updateTurnStatus(actor, turn.id, 'needs_input');
      const approval: ApprovalRecord = {
        id: 'approval-1',
        taskId: task.id,
        turnId: turn.id,
        reason: 'Destructive action',
        actions: [{ kind: 'exec', summary: 'Delete generated files', command: 'rm -r dist' }],
        status: 'pending',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      await store.saveApproval(actor, approval);
      expect((await store.getSnapshot(actor, task.id))?.snapshot.pendingApproval?.actions).toEqual([
        { kind: 'exec', summary: 'Delete generated files' },
      ]);
      await expect(store.resolveApproval(actor, approval.id, 'approved')).resolves.toMatchObject({
        status: 'approved',
      });
      await expect(store.resolveApproval(actor, approval.id, 'rejected')).rejects.toMatchObject({
        code: 'conflict',
      });
    });

    it('cancels the paused turn when its approval is rejected', async () => {
      const { task, turn } = await createTaskAndTurn();
      await store.updateTurnStatus(actor, turn.id, 'working');
      await store.updateTurnStatus(actor, turn.id, 'needs_input');
      await store.saveApproval(actor, {
        id: 'approval-reject',
        taskId: task.id,
        turnId: turn.id,
        reason: 'Destructive action',
        actions: [{ kind: 'exec', summary: 'Delete generated files', command: 'rm -r dist' }],
        status: 'pending',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      });

      await store.resolveApproval(actor, 'approval-reject', 'rejected');
      await expect(store.getTurn(actor, turn.id)).resolves.toMatchObject({ status: 'cancelled' });
    });
  });
}
