import { randomUUID } from 'node:crypto';

import {
  TaskError,
  conflictError,
  internalError,
  missingResourceError,
  type ActionRiskEvaluator,
  type ActorContext,
  type ApprovalRecord,
  type CodingAgent,
  type CodingEvent,
  type ExecutivePresenter,
  type ReplayableServerMessage,
  type TaskEventLog,
  type TaskRecord,
  type TaskRunRegistry,
  type TaskStore,
  type TaskView,
  type Turn,
  type TurnMode,
  type WorkspaceLease,
  type WorkspaceProvider,
} from '@voice-agent/contracts';

export interface TaskOrchestratorDependencies {
  readonly taskStore: TaskStore;
  readonly eventLog: TaskEventLog;
  readonly runRegistry: TaskRunRegistry;
  readonly workspaceProvider: WorkspaceProvider;
  readonly codingAgent: CodingAgent;
  readonly presenter: ExecutivePresenter;
  readonly riskEvaluator: ActionRiskEvaluator;
}

export interface StartTaskInput {
  readonly workspaceId: string;
  readonly title: string;
  readonly mode: TurnMode;
  readonly text: string;
}

export interface StartTurnResult {
  readonly task: TaskView;
  readonly turn: Turn;
  readonly completion: Promise<void>;
}

export interface ApprovalResult {
  readonly approval: ApprovalRecord;
  readonly completion: Promise<void>;
}

interface PausedRun {
  readonly context: ActorContext;
  readonly task: TaskRecord;
  readonly turn: Turn;
  readonly workspace: WorkspaceLease;
  readonly events: CodingEvent[];
}

const pendingEventId = '0';

export class TaskOrchestrator {
  private readonly paused = new Map<string, PausedRun>();

  constructor(private readonly dependencies: TaskOrchestratorDependencies) {}

  async createTask(context: ActorContext, input: StartTaskInput): Promise<StartTurnResult> {
    const record = await this.dependencies.taskStore.createTask(context, input);
    const turn = await this.dependencies.taskStore.createTurn(context, {
      taskId: record.id,
      mode: input.mode,
      text: input.text,
    });
    const task = (await this.dependencies.taskStore.listTasks(context)).find(({ id }) => id === record.id);
    if (!task) throw internalError('The new task could not be loaded.');
    await this.emit(context, record.id, { type: 'task.created', eventId: pendingEventId, task });
    await this.emit(context, record.id, { type: 'turn.created', eventId: pendingEventId, turn });
    return { task, turn, completion: this.execute(context, record, turn) };
  }

  async createTurn(
    context: ActorContext,
    taskId: string,
    input: { readonly mode: TurnMode; readonly text: string },
  ): Promise<StartTurnResult> {
    const record = await this.requireTask(context, taskId);
    if (this.dependencies.runRegistry.getActive(taskId)) {
      throw conflictError(`Task "${taskId}" already has an active run.`);
    }
    const turn = await this.dependencies.taskStore.createTurn(context, { taskId, ...input });
    const task = (await this.dependencies.taskStore.listTasks(context)).find(({ id }) => id === taskId);
    if (!task) throw missingResourceError(`No task with ID "${taskId}".`);
    await this.emit(context, taskId, { type: 'turn.created', eventId: pendingEventId, turn });
    return { task, turn, completion: this.execute(context, record, turn) };
  }

  async cancel(context: ActorContext, taskId: string, commandId: string): Promise<void> {
    await this.requireTask(context, taskId);
    const active = this.dependencies.runRegistry.getActive(taskId);
    if (!active) return;
    this.dependencies.runRegistry.cancel(taskId);
    const turn = await this.dependencies.taskStore.getTurn(context, active.turnId);
    if (turn && (turn.status === 'queued' || turn.status === 'working' || turn.status === 'needs_input')) {
      const snapshot = await this.dependencies.taskStore.getSnapshot(context, taskId);
      if (snapshot?.snapshot.pendingApproval) {
        await this.dependencies.taskStore.resolveApproval(
          context,
          snapshot.snapshot.pendingApproval.id,
          'superseded',
        );
      }
      await this.dependencies.taskStore.updateTurnStatus(context, turn.id, 'cancelled');
      await this.emitStatus(context, taskId, turn.id, 'cancelled');
      await this.emit(context, taskId, {
        type: 'task.cancelled',
        eventId: pendingEventId,
        taskId,
        turnId: turn.id,
        commandId,
      });
    }
    const paused = this.paused.get(taskId);
    if (paused) {
      this.paused.delete(taskId);
      await this.dependencies.workspaceProvider.release(paused.workspace.leaseId);
    }
  }

  async resolveApproval(
    context: ActorContext,
    taskId: string,
    approvalId: string,
    decision: 'approve' | 'reject',
    commandId: string,
  ): Promise<ApprovalResult> {
    await this.requireTask(context, taskId);
    const paused = this.paused.get(taskId);
    if (!paused) throw conflictError(`Approval "${approvalId}" is stale for its turn.`);
    const approval = await this.dependencies.taskStore.resolveApproval(
      context,
      approvalId,
      decision === 'approve' ? 'approved' : 'rejected',
    );
    await this.emit(context, taskId, {
      type: 'approval.resolved',
      eventId: pendingEventId,
      taskId,
      approvalId,
      decision,
      commandId,
    });
    if (decision === 'reject') {
      this.paused.delete(taskId);
      this.dependencies.runRegistry.end(taskId);
      await this.emitStatus(context, taskId, paused.turn.id, 'cancelled');
      await this.emit(context, taskId, {
        type: 'task.cancelled',
        eventId: pendingEventId,
        taskId,
        turnId: paused.turn.id,
        commandId,
      });
      await this.dependencies.workspaceProvider.release(paused.workspace.leaseId);
      return { approval, completion: Promise.resolve() };
    }

    await this.dependencies.taskStore.updateTurnStatus(context, paused.turn.id, 'working');
    await this.emitStatus(context, taskId, paused.turn.id, 'working');
    this.paused.delete(taskId);
    return { approval, completion: this.continueRun(paused, true) };
  }

  private async execute(context: ActorContext, task: TaskRecord, turn: Turn): Promise<void> {
    const handle = this.dependencies.runRegistry.begin({ taskId: task.id, turnId: turn.id });
    let workspace: WorkspaceLease | undefined;
    let keepLease = false;
    try {
      await this.dependencies.taskStore.updateTurnStatus(context, turn.id, 'working');
      await this.emitStatus(context, task.id, turn.id, 'working');
      workspace = await this.dependencies.workspaceProvider.acquire({
        taskId: task.id,
        workspaceId: task.workspaceId,
      });
      const events: CodingEvent[] = [];
      if (task.agentThreadId) {
        await this.consume(
          this.dependencies.codingAgent.resume({
            taskId: task.id,
            turnId: turn.id,
            workspace,
            signal: handle.signal,
            agentThreadId: task.agentThreadId,
            instructions: turn.text,
          }),
          events,
        );
        if (!handle.signal.aborted) await this.finish(context, task.id, turn.id, events);
        return;
      }

      await this.consume(
        this.dependencies.codingAgent.plan({
          taskId: task.id,
          turnId: turn.id,
          workspace,
          signal: handle.signal,
          instructions: turn.text,
        }),
        events,
      );
      if (handle.signal.aborted) return;
      const failed = events.find(({ type }) => type === 'failed');
      if (failed?.type === 'failed') {
        await this.fail(context, task.id, turn.id, failed.error);
        return;
      }
      const thread = events.find(({ type }) => type === 'thread_ready');
      const plan = events.find(({ type }) => type === 'plan_ready');
      if (thread?.type !== 'thread_ready' || plan?.type !== 'plan_ready') {
        throw internalError('The coding agent returned an incomplete plan.');
      }
      task = await this.dependencies.taskStore.setAgentThreadId(context, task.id, thread.threadId);
      await this.emit(context, task.id, {
        type: 'intent.confirmed',
        eventId: pendingEventId,
        taskId: task.id,
        turnId: turn.id,
        actions: plan.actions.map(({ kind, summary }) => ({ kind, summary })),
      });
      const risk = await this.dependencies.riskEvaluator.evaluate({
        taskId: task.id,
        turnId: turn.id,
        actions: plan.actions,
      });
      if (risk.level === 'sensitive') {
        await this.dependencies.taskStore.updateTurnStatus(context, turn.id, 'needs_input');
        const approval: ApprovalRecord = {
          id: randomUUID(),
          taskId: task.id,
          turnId: turn.id,
          reason: risk.reasons.join(' ') || 'Sensitive action requires approval.',
          actions: plan.actions,
          status: 'pending',
          createdAt: new Date().toISOString(),
          resolvedAt: null,
        };
        await this.dependencies.taskStore.saveApproval(context, approval);
        const snapshot = await this.dependencies.taskStore.getSnapshot(context, task.id);
        if (!snapshot?.snapshot.pendingApproval) throw internalError('The pending approval could not be loaded.');
        if (handle.signal.aborted) return;
        this.paused.set(task.id, { context, task, turn, workspace, events });
        keepLease = true;
        if (handle.signal.aborted) {
          if (this.paused.has(task.id)) {
            this.paused.delete(task.id);
            keepLease = false;
          }
          return;
        }
        await this.emitStatus(context, task.id, turn.id, 'needs_input');
        if (handle.signal.aborted) {
          if (this.paused.has(task.id)) {
            this.paused.delete(task.id);
            keepLease = false;
          }
          return;
        }
        await this.emit(context, task.id, {
          type: 'approval.required',
          eventId: pendingEventId,
          approval: snapshot.snapshot.pendingApproval,
        });
        return;
      }
      await this.consume(
        this.dependencies.codingAgent.run({
          taskId: task.id,
          turnId: turn.id,
          workspace,
          signal: handle.signal,
          agentThreadId: thread.threadId,
        }),
        events,
      );
      if (!handle.signal.aborted) await this.finish(context, task.id, turn.id, events);
    } catch (error) {
      if (!handle.signal.aborted) {
        const problem = error instanceof TaskError ? error.toProblem() : internalError('Task execution failed.').toProblem();
        await this.fail(context, task.id, turn.id, problem);
      }
    } finally {
      if (!keepLease) {
        this.dependencies.runRegistry.end(task.id);
        if (workspace) await this.dependencies.workspaceProvider.release(workspace.leaseId);
      }
    }
  }

  private async continueRun(paused: PausedRun, approved: boolean): Promise<void> {
    const handle = this.dependencies.runRegistry.getActive(paused.task.id);
    if (!handle) throw conflictError(`Task "${paused.task.id}" has no active run.`);
    try {
      const events = [...paused.events];
      await this.consume(
        this.dependencies.codingAgent.resume({
          taskId: paused.task.id,
          turnId: paused.turn.id,
          workspace: paused.workspace,
          signal: handle.signal,
          agentThreadId: paused.task.agentThreadId!,
          instructions: approved ? 'The user approved the proposed plan. Continue.' : paused.turn.text,
        }),
        events,
      );
      if (!handle.signal.aborted) await this.finish(paused.context, paused.task.id, paused.turn.id, events);
    } catch (error) {
      if (!handle.signal.aborted) {
        const problem = error instanceof TaskError ? error.toProblem() : internalError('Task execution failed.').toProblem();
        await this.fail(paused.context, paused.task.id, paused.turn.id, problem);
      }
    } finally {
      this.dependencies.runRegistry.end(paused.task.id);
      await this.dependencies.workspaceProvider.release(paused.workspace.leaseId);
    }
  }

  private async finish(
    context: ActorContext,
    taskId: string,
    turnId: string,
    events: CodingEvent[],
  ): Promise<void> {
    const failure = events.find(({ type }) => type === 'failed');
    if (failure?.type === 'failed') {
      await this.fail(context, taskId, turnId, failure.error);
      return;
    }
    await this.dependencies.taskStore.updateTurnStatus(context, turnId, 'completed');
    const { update } = await this.dependencies.presenter.summarizeOutcome({
      taskId,
      turnId,
      events,
      status: 'completed',
    });
    await this.dependencies.taskStore.appendUpdate(context, update);
    await this.emitStatus(context, taskId, turnId, 'completed');
    await this.emit(context, taskId, {
      type: 'task.completed',
      eventId: pendingEventId,
      taskId,
      turnId,
      update,
    });
  }

  private async fail(
    context: ActorContext,
    taskId: string,
    turnId: string,
    error: ReturnType<TaskError['toProblem']>,
  ): Promise<void> {
    const turn = await this.dependencies.taskStore.getTurn(context, turnId);
    if (turn?.status === 'needs_input') {
      const snapshot = await this.dependencies.taskStore.getSnapshot(context, taskId);
      if (snapshot?.snapshot.pendingApproval) {
        await this.dependencies.taskStore.resolveApproval(
          context,
          snapshot.snapshot.pendingApproval.id,
          'superseded',
        );
      }
      const paused = this.paused.get(taskId);
      if (paused) {
        this.paused.delete(taskId);
        this.dependencies.runRegistry.end(taskId);
        await this.dependencies.workspaceProvider.release(paused.workspace.leaseId);
      }
      // needs_input → failed is illegal; resume working first, then fail.
      await this.dependencies.taskStore.updateTurnStatus(context, turnId, 'working');
      await this.dependencies.taskStore.updateTurnStatus(context, turnId, 'failed');
      await this.emitStatus(context, taskId, turnId, 'failed');
    } else if (turn?.status === 'working') {
      await this.dependencies.taskStore.updateTurnStatus(context, turnId, 'failed');
      await this.emitStatus(context, taskId, turnId, 'failed');
    }
    await this.emit(context, taskId, {
      type: 'task.failed',
      eventId: pendingEventId,
      taskId,
      turnId,
      error,
    });
  }

  private async consume(source: AsyncIterable<CodingEvent>, events: CodingEvent[]): Promise<void> {
    for await (const event of source) events.push(event);
  }

  private async requireTask(context: ActorContext, taskId: string): Promise<TaskRecord> {
    const task = await this.dependencies.taskStore.getTask(context, taskId);
    if (!task) throw missingResourceError(`No task with ID "${taskId}".`);
    return task;
  }

  private async emitStatus(
    context: ActorContext,
    taskId: string,
    turnId: string,
    status: Turn['status'],
  ): Promise<void> {
    await this.emit(context, taskId, {
      type: 'turn.status_changed',
      eventId: pendingEventId,
      taskId,
      turnId,
      status,
    });
  }

  private async emit(
    context: ActorContext,
    taskId: string,
    message: ReplayableServerMessage,
  ): Promise<void> {
    await this.dependencies.eventLog.append(context, taskId, message);
  }
}
