import { randomUUID } from 'node:crypto';
import type {
  ApprovalRecord,
  ApprovalRequest,
  ExecutiveUpdate,
  SnapshotEnvelope,
  TaskRecord,
  TaskView,
  Turn,
} from '../../domain.js';
import { conflictError, missingResourceError } from '../../errors.js';
import type { ActorContext } from '../../ports/actor-context.js';
import type { CreateTaskInput, CreateTurnInput, TaskStore } from '../../ports/task-store.js';
import { isActiveTurnStatus, transitionTurnStatus, type TurnStatus } from '../../status.js';

export class InMemoryFakeTaskStore implements TaskStore {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly turns = new Map<string, Turn>();
  private readonly turnsByTask = new Map<string, string[]>();
  private readonly updatesByTask = new Map<string, ExecutiveUpdate[]>();
  private readonly approvals = new Map<string, ApprovalRecord>();

  private ownedTask(context: ActorContext, taskId: string): TaskRecord | null {
    const task = this.tasks.get(taskId);
    return task?.actorId === context.actorId ? task : null;
  }

  private requireTask(context: ActorContext, taskId: string): TaskRecord {
    const task = this.ownedTask(context, taskId);
    if (!task) throw missingResourceError(`No task with ID "${taskId}".`);
    return task;
  }

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
    this.tasks.set(task.id, task);
    this.turnsByTask.set(task.id, []);
    this.updatesByTask.set(task.id, []);
    return task;
  }

  async getTask(context: ActorContext, taskId: string): Promise<TaskRecord | null> {
    return this.ownedTask(context, taskId);
  }

  async listTasks(context: ActorContext): Promise<TaskView[]> {
    return [...this.tasks.values()]
      .filter((task) => task.actorId === context.actorId)
      .flatMap((task) => {
        const latest = this.turnsFor(task.id).at(-1);
        return latest ? [this.toView(task, latest)] : [];
      });
  }

  async updateTurnStatus(
    context: ActorContext,
    turnId: string,
    status: TurnStatus,
    requestId?: string,
  ): Promise<Turn> {
    const turn = await this.getTurn(context, turnId);
    if (!turn) throw missingResourceError(`No turn with ID "${turnId}".`);
    const next = transitionTurnStatus(turn.status, status, requestId ? { requestId } : {});
    const updated = { ...turn, status: next, updatedAt: new Date().toISOString() };
    this.turns.set(turnId, updated);
    return updated;
  }

  async setAgentThreadId(context: ActorContext, taskId: string, agentThreadId: string): Promise<TaskRecord> {
    const task = this.requireTask(context, taskId);
    const updated = { ...task, agentThreadId, updatedAt: new Date().toISOString() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async createTurn(context: ActorContext, input: CreateTurnInput): Promise<Turn> {
    this.requireTask(context, input.taskId);
    if (this.turnsFor(input.taskId).some((turn) => isActiveTurnStatus(turn.status))) {
      throw conflictError(`Task "${input.taskId}" already has an active turn.`);
    }
    const now = new Date().toISOString();
    const turn: Turn = { id: randomUUID(), ...input, status: 'queued', createdAt: now, updatedAt: now };
    this.turns.set(turn.id, turn);
    this.turnsByTask.get(input.taskId)?.push(turn.id);
    return turn;
  }

  async getTurn(context: ActorContext, turnId: string): Promise<Turn | null> {
    const turn = this.turns.get(turnId);
    return turn && this.ownedTask(context, turn.taskId) ? turn : null;
  }

  async listTurns(context: ActorContext, taskId: string): Promise<Turn[]> {
    this.requireTask(context, taskId);
    return this.turnsFor(taskId);
  }

  async appendUpdate(context: ActorContext, update: ExecutiveUpdate): Promise<void> {
    this.requireTask(context, update.taskId);
    const turn = await this.getTurn(context, update.turnId);
    if (!turn || turn.taskId !== update.taskId) {
      throw conflictError(`Update turn "${update.turnId}" does not belong to task "${update.taskId}".`);
    }
    this.updatesByTask.get(update.taskId)?.push(update);
  }

  async saveApproval(context: ActorContext, approval: ApprovalRecord): Promise<ApprovalRecord> {
    this.requireTask(context, approval.taskId);
    const turn = await this.getTurn(context, approval.turnId);
    if (!turn || turn.taskId !== approval.taskId) {
      throw conflictError(`Approval turn "${approval.turnId}" does not belong to task "${approval.taskId}".`);
    }
    if (turn.status !== 'needs_input' || approval.status !== 'pending' || approval.resolvedAt !== null) {
      throw conflictError('A pending approval requires a turn in needs_input state.');
    }
    const hasPending = [...this.approvals.values()].some(
      (existing) => existing.taskId === approval.taskId && existing.status === 'pending',
    );
    if (hasPending) throw conflictError(`Task "${approval.taskId}" already has a pending approval.`);
    this.approvals.set(approval.id, approval);
    return approval;
  }

  async resolveApproval(
    context: ActorContext,
    approvalId: string,
    status: 'approved' | 'rejected' | 'superseded',
  ): Promise<ApprovalRecord> {
    const approval = this.approvals.get(approvalId);
    if (!approval || !this.ownedTask(context, approval.taskId)) {
      throw missingResourceError(`No approval with ID "${approvalId}".`);
    }
    if (approval.status !== 'pending') throw conflictError(`Approval "${approvalId}" is already resolved.`);
    const turn = await this.getTurn(context, approval.turnId);
    if (!turn || turn.status !== 'needs_input') {
      throw conflictError(`Approval "${approvalId}" is stale for its turn.`);
    }
    const updated = { ...approval, status, resolvedAt: new Date().toISOString() };
    this.approvals.set(approvalId, updated);
    if (status === 'rejected') {
      const cancelled = {
        ...turn,
        status: transitionTurnStatus(turn.status, 'cancelled'),
        updatedAt: new Date().toISOString(),
      };
      this.turns.set(turn.id, cancelled);
    }
    return updated;
  }

  async getSnapshot(context: ActorContext, taskId: string): Promise<SnapshotEnvelope | null> {
    const task = this.ownedTask(context, taskId);
    const turns = task ? this.turnsFor(taskId) : [];
    const latest = turns.at(-1);
    if (!task || !latest) return null;
    const pending = [...this.approvals.values()].find(
      (approval) => approval.taskId === taskId && approval.status === 'pending',
    );
    return {
      snapshot: {
        task: this.toView(task, latest),
        turns,
        updates: [...(this.updatesByTask.get(taskId) ?? [])],
        pendingApproval: pending ? this.toApprovalRequest(pending) : null,
      },
      lastEventId: null,
    };
  }

  private turnsFor(taskId: string): Turn[] {
    return (this.turnsByTask.get(taskId) ?? []).flatMap((id) => {
      const turn = this.turns.get(id);
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
