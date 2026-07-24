import { describe, expect, it } from 'vitest';

import {
  type CodingAgent,
  type CodingEvent,
  type PlanInput,
  type ResumeInput,
  type RunInput,
} from '@voice-agent/contracts';
import {
  FakeActionRiskEvaluator,
  FakeCodingAgent,
  FakeExecutivePresenter,
  InMemoryFakeWorkspaceProvider,
} from '@voice-agent/contracts/testing';
import { createMemoryTaskAdapters } from '@voice-agent/task-store-memory';

import { TaskOrchestrator } from './task-orchestrator.js';

const actor = { actorId: 'demo-user' };

class SensitiveAgent extends FakeCodingAgent {
  override async *plan(input: PlanInput): AsyncIterable<CodingEvent> {
    if (input.signal.aborted) return;
    yield { type: 'thread_ready', threadId: 'sensitive-thread' };
    yield {
      type: 'plan_ready',
      actions: [{ kind: 'exec', summary: 'Delete generated output', command: 'rm -rf dist' }],
    };
  }
}

class BlockingAgent extends FakeCodingAgent {
  override async *run(input: RunInput): AsyncIterable<CodingEvent> {
    await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
  }
}

class ResumeSpyAgent extends FakeCodingAgent {
  resumeCalls = 0;

  override async *resume(input: ResumeInput): AsyncIterable<CodingEvent> {
    this.resumeCalls += 1;
    yield* super.resume(input);
  }
}

function setup(codingAgent: CodingAgent = new FakeCodingAgent()) {
  const memory = createMemoryTaskAdapters();
  return {
    memory,
    orchestrator: new TaskOrchestrator({
      ...memory,
      workspaceProvider: new InMemoryFakeWorkspaceProvider(),
      codingAgent,
      presenter: new FakeExecutivePresenter(),
      riskEvaluator: new FakeActionRiskEvaluator(),
    }),
  };
}

async function start(orchestrator: TaskOrchestrator) {
  return orchestrator.createTask(actor, {
    workspaceId: 'demo-repo',
    title: 'Fix checkout',
    mode: 'typing',
    text: 'Fix the checkout bug',
  });
}

describe('TaskOrchestrator', () => {
  it('runs a safe plan to completion and emits browser-safe events', async () => {
    const { orchestrator, memory } = setup();
    const result = await start(orchestrator);
    await result.completion;

    const snapshot = await memory.taskStore.getSnapshot(actor, result.task.id);
    const replay = await memory.eventLog.readSince(actor, result.task.id, '1');
    expect(snapshot?.snapshot.turns[0]?.status).toBe('completed');
    expect(snapshot?.snapshot.updates[0]?.phase).toBe('completed');
    expect(replay.kind === 'replay' && replay.events.map(({ message }) => message.type)).toContain('task.completed');
  });

  it('approves a sensitive plan, rejects another, and rejects stale approval', async () => {
    const { orchestrator, memory } = setup(new SensitiveAgent());
    const approved = await start(orchestrator);
    await approved.completion;
    const approval = (await memory.taskStore.getSnapshot(actor, approved.task.id))?.snapshot.pendingApproval;
    expect(approval).not.toBeNull();
    await expect(
      orchestrator.createTurn(actor, approved.task.id, { mode: 'typing', text: 'Overlap' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const resolution = await orchestrator.resolveApproval(actor, approved.task.id, approval!.id, 'approve', 'approve-1');
    await resolution.completion;
    expect((await memory.taskStore.getSnapshot(actor, approved.task.id))?.snapshot.task.status).toBe('completed');
    await expect(
      orchestrator.resolveApproval(actor, approved.task.id, approval!.id, 'approve', 'approve-2'),
    ).rejects.toMatchObject({ code: 'conflict' });

    const rejected = await start(orchestrator);
    await rejected.completion;
    const rejectedApproval = (await memory.taskStore.getSnapshot(actor, rejected.task.id))?.snapshot.pendingApproval;
    await (await orchestrator.resolveApproval(actor, rejected.task.id, rejectedApproval!.id, 'reject', 'reject-1')).completion;
    expect((await memory.taskStore.getSnapshot(actor, rejected.task.id))?.snapshot.task.status).toBe('cancelled');

    const cancelled = await start(orchestrator);
    await cancelled.completion;
    await orchestrator.cancel(actor, cancelled.task.id, 'cancel-sensitive');
    expect((await memory.taskStore.getSnapshot(actor, cancelled.task.id))?.snapshot.pendingApproval).toBeNull();
  });

  it('cancels an active run without allowing a later completion', async () => {
    const { orchestrator, memory } = setup(new BlockingAgent());
    const result = await start(orchestrator);
    await new Promise((resolve) => setImmediate(resolve));
    await orchestrator.cancel(actor, result.task.id, 'cancel-1');
    await result.completion;
    expect((await memory.taskStore.getSnapshot(actor, result.task.id))?.snapshot.task.status).toBe('cancelled');
  });

  it('resumes the existing agent thread for a follow-up turn', async () => {
    const agent = new ResumeSpyAgent();
    const { orchestrator, memory } = setup(agent);
    const first = await start(orchestrator);
    await first.completion;
    const second = await orchestrator.createTurn(actor, first.task.id, { mode: 'typing', text: 'Add a test' });
    await second.completion;
    expect(agent.resumeCalls).toBe(1);
    expect((await memory.taskStore.listTurns(actor, first.task.id)).map(({ status }) => status)).toEqual([
      'completed',
      'completed',
    ]);
  });

  it('turns typed agent failures into a failed terminal event', async () => {
    const { orchestrator, memory } = setup(new FakeCodingAgent('outage'));
    const result = await start(orchestrator);
    await result.completion;
    const snapshot = await memory.taskStore.getSnapshot(actor, result.task.id);
    expect(snapshot?.snapshot.task.status).toBe('failed');
    const events = await memory.eventLog.readSince(actor, result.task.id, '1');
    expect(events.kind === 'replay' && events.events.at(-1)?.message.type).toBe('task.failed');
  });

  it('preserves actor isolation', async () => {
    const { orchestrator } = setup();
    const result = await start(orchestrator);
    await expect(orchestrator.cancel({ actorId: 'other-user' }, result.task.id, 'wrong-actor')).rejects.toMatchObject({
      code: 'not_found',
    });
    await orchestrator.cancel(actor, result.task.id, 'cleanup');
    await result.completion;
  });
});
