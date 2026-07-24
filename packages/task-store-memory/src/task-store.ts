import { randomUUID } from 'node:crypto';
import {
  conflictError,
  isActiveTurnStatus,
  missingResourceError,
  transitionTurnStatus,
  type ActorContext,
  type ApprovalRecord,
  type ApprovalRequest,
  type CreateTaskInput,
  type CreateTurnInput,
  type ExecutiveUpdate,
  type SnapshotEnvelope,
  type TaskRecord,
  type TaskStore,
  type TaskView,
  type Turn,
  type TurnStatus,
} from '@voice-agent/contracts';

import { copy, MemoryTaskState } from './state.js';

export class MemoryTaskStore implements TaskStore {
  constructor(private readonly state = new MemoryTaskState()) {}

  async createTask(context: ActorContext, input: CreateTaskInput): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: randomUUID(),
      actorId: context.actorId,
      workspaceId: input.workspaceId,
      title: input.title,
      agentThreadId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.state.tasks.set(task.id, task);
    this.state.turnsByTask.set(task.id, []);
    this.state.updatesByTask.set(task.id, []);
    return copy(task);
  }

  async getTask(context: ActorContext, taskId: string): Promise<TaskRecord | null> {
    const task = this.ownedTask(context, taskId);
    return task ? copy(task) : null;
  }

  async listTasks(context: ActorContext): Promise<TaskView[]> {
    return [...this.state.tasks.values()]
      .filter(({ actorId }) => actorId === context.actorId)
      .flatMap((task) => {
        const latest = this.turnsFor(task.id).at(-1);
        return latest ? [this.toView(task, latest)] : [];
      })
      .map(copy);
  }

  async updateTurnStatus(
    context: ActorContext,
    turnId: string,
    status: TurnStatus,
    requestId?: string,
  ): Promise<Turn> {
    const turn = this.ownedTurn(context, turnId);
    if (!turn) throw missingResourceError(`No turn with ID "${turnId}".`);
    const next = transitionTurnStatus(turn.status, status, requestId ? { requestId } : {});
    const updated = { ...turn, status: next, updatedAt: new Date().toISOString() };
    this.state.turns.set(turnId, updated);
    return copy(updated);
  }

  async setAgentThreadId(
    context: ActorContext,
    taskId: string,
    agentThreadId: string,
  ): Promise<TaskRecord> {
    const task = this.requireTask(context, taskId);
    const updated = { ...task, agentThreadId, updatedAt: new Date().toISOString() };
    this.state.tasks.set(taskId, updated);
    return copy(updated);
  }

  async createTurn(context: ActorContext, input: CreateTurnInput): Promise<Turn> {
    this.requireTask(context, input.taskId);
    if (this.turnsFor(input.taskId).some(({ status }) => isActiveTurnStatus(status))) {
      throw conflictError(`Task "${input.taskId}" already has an active turn.`);
    }
    const now = new Date().toISOString();
    const turn: Turn = {
      id: randomUUID(),
      ...input,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.state.turns.set(turn.id, turn);
    this.state.turnsByTask.get(input.taskId)?.push(turn.id);
    return copy(turn);
  }

  async getTurn(context: ActorContext, turnId: string): Promise<Turn | null> {
    const turn = this.ownedTurn(context, turnId);
    return turn ? copy(turn) : null;
  }

  async listTurns(context: ActorContext, taskId: string): Promise<Turn[]> {
    this.requireTask(context, taskId);
    return this.turnsFor(taskId).map(copy);
  }

  async appendUpdate(context: ActorContext, update: ExecutiveUpdate): Promise<void> {
    this.requireTask(context, update.taskId);
    const turn = this.ownedTurn(context, update.turnId);
    if (!turn || turn.taskId !== update.taskId) {
      throw conflictError(`Update turn "${update.turnId}" does not belong to task "${update.taskId}".`);
    }
    this.state.updatesByTask.get(update.taskId)?.push(copy(update));
  }

  async saveApproval(
    context: ActorContext,
    approval: ApprovalRecord,
  ): Promise<ApprovalRecord> {
    this.requireTask(context, approval.taskId);
    const turn = this.ownedTurn(context, approval.turnId);
    if (!turn || turn.taskId !== approval.taskId) {
      throw conflictError(
        `Approval turn "${approval.turnId}" does not belong to task "${approval.taskId}".`,
      );
    }
    if (turn.status !== 'needs_input' || approval.status !== 'pending' || approval.resolvedAt !== null) {
      throw conflictError('A pending approval requires a turn in needs_input state.');
    }
    if (
      [...this.state.approvals.values()].some(
        (existing) => existing.taskId === approval.taskId && existing.status === 'pending',
      )
    ) {
      throw conflictError(`Task "${approval.taskId}" already has a pending approval.`);
    }
    if (this.state.approvals.has(approval.id)) {
      throw conflictError(`Approval "${approval.id}" already exists.`);
    }
    this.state.approvals.set(approval.id, copy(approval));
    return copy(approval);
  }

  async resolveApproval(
    context: ActorContext,
    approvalId: string,
    status: 'approved' | 'rejected' | 'superseded',
  ): Promise<ApprovalRecord> {
    const approval = this.state.approvals.get(approvalId);
    if (!approval || !this.ownedTask(context, approval.taskId)) {
      throw missingResourceError(`No approval with ID "${approvalId}".`);
    }
    if (approval.status !== 'pending') {
      throw conflictError(`Approval "${approvalId}" is already resolved.`);
    }
    const turn = this.ownedTurn(context, approval.turnId);
    if (!turn || turn.status !== 'needs_input') {
      throw conflictError(`Approval "${approvalId}" is stale for its turn.`);
    }
    const updated: ApprovalRecord = {
      ...approval,
      status,
      resolvedAt: new Date().toISOString(),
    };
    this.state.approvals.set(approvalId, updated);
    if (status === 'rejected') {
      this.state.turns.set(turn.id, {
        ...turn,
        status: transitionTurnStatus(turn.status, 'cancelled'),
        updatedAt: new Date().toISOString(),
      });
    }
    return copy(updated);
  }

  async getSnapshot(context: ActorContext, taskId: string): Promise<SnapshotEnvelope | null> {
    const task = this.ownedTask(context, taskId);
    if (!task) return null;
    const turns = this.turnsFor(taskId);
    const latest = turns.at(-1);
    if (!latest) return null;
    const pending = [...this.state.approvals.values()].find(
      (approval) => approval.taskId === taskId && approval.status === 'pending',
    );
    const stream = this.state.eventStreams.get(this.state.streamKey(context.actorId, taskId));
    return copy({
      snapshot: {
        task: this.toView(task, latest),
        turns,
        updates: this.state.updatesByTask.get(taskId) ?? [],
        pendingApproval: pending ? this.toApprovalRequest(pending) : null,
      },
      lastEventId: stream?.records.at(-1)?.id ?? null,
    });
  }

  private ownedTask(context: ActorContext, taskId: string): TaskRecord | null {
    const task = this.state.tasks.get(taskId);
    return task?.actorId === context.actorId ? task : null;
  }

  private requireTask(context: ActorContext, taskId: string): TaskRecord {
    const task = this.ownedTask(context, taskId);
    if (!task) throw missingResourceError(`No task with ID "${taskId}".`);
    return task;
  }

  private ownedTurn(context: ActorContext, turnId: string): Turn | null {
    const turn = this.state.turns.get(turnId);
    return turn && this.ownedTask(context, turn.taskId) ? turn : null;
  }

  private turnsFor(taskId: string): Turn[] {
    return (this.state.turnsByTask.get(taskId) ?? []).flatMap((id) => {
      const turn = this.state.turns.get(id);
      return turn ? [turn] : [];
    });
  }

  private toView(task: TaskRecord, latest: Turn): TaskView {
    return {
      id: task.id,
      title: task.title,
      status: latest.status,
      createdAt: task.createdAt,
      updatedAt: latest.updatedAt,
    };
  }

  private toApprovalRequest(record: ApprovalRecord): ApprovalRequest {
    return {
      id: record.id,
      taskId: record.taskId,
      turnId: record.turnId,
      reason: record.reason,
      actions: record.actions.map(({ kind, summary }) => ({ kind, summary })),
      createdAt: record.createdAt,
    };
  }
}
