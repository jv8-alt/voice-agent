import { afterEach, describe, expect, it } from 'vitest';

import {
  CreateTaskResponseSchema,
  CreateVoiceClientSecretResponseSchema,
  ServerMessageSchema,
  type CodingEvent,
  type PlanInput,
  type RunInput,
  type ServerMessage,
} from '@voice-agent/contracts';
import {
  FakeActionRiskEvaluator,
  FakeCodingAgent,
  FakeExecutivePresenter,
  InMemoryFakeWorkspaceProvider,
} from '@voice-agent/contracts/testing';
import { createMemoryTaskAdapters } from '@voice-agent/task-store-memory';

import { buildTaskApi } from './app.js';
import type { TaskApiConfig } from './config.js';
import { registerTaskRoutes } from './routes.js';
import { TaskOrchestrator } from './task-orchestrator.js';

const config: TaskApiConfig = {
  openAiApiKey: 'test-key',
  port: 3001,
  webOrigin: 'http://localhost:3000',
  demoRepoId: 'fixture-repo',
};
const apps: Awaited<ReturnType<typeof buildTaskApi>>[] = [];

class SensitiveAgent extends FakeCodingAgent {
  override async *plan(input: PlanInput): AsyncIterable<CodingEvent> {
    if (input.signal.aborted) return;
    yield { type: 'thread_ready', threadId: 'sensitive-thread' };
    yield {
      type: 'plan_ready',
      actions: [{ kind: 'exec', summary: 'Delete output', command: 'rm -rf dist' }],
    };
  }
}

class BlockingAgent extends FakeCodingAgent {
  override async *run(input: RunInput): AsyncIterable<CodingEvent> {
    await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(codingAgent = new FakeCodingAgent()) {
  const memory = createMemoryTaskAdapters({ replayCapacity: 20 });
  const orchestrator = new TaskOrchestrator({
    ...memory,
    workspaceProvider: new InMemoryFakeWorkspaceProvider(),
    codingAgent,
    presenter: new FakeExecutivePresenter(),
    riskEvaluator: new FakeActionRiskEvaluator(),
  });
  const dependencies = {
    ...memory,
    orchestrator,
    voiceClientSecrets: {
      async create() {
        return { clientSecret: 'ephemeral-secret', expiresAt: '2030-01-01T00:00:00.000Z' };
      },
    },
  };
  const app = await buildTaskApi({
    config,
    dependencies,
    register(instance, context) {
      return registerTaskRoutes(instance, context.dependencies, context.config);
    },
  });
  apps.push(app);
  return { app, memory };
}

async function create(app: Awaited<ReturnType<typeof buildTaskApi>>) {
  const response = await app.inject({
    method: 'POST',
    url: '/tasks',
    payload: { title: 'Fix checkout', turn: { mode: 'typing', text: 'Fix the checkout bug' } },
  });
  expect(response.statusCode).toBe(201);
  return CreateTaskResponseSchema.parse(response.json());
}

function messages(socket: { on(event: 'message', listener: (raw: Buffer) => void): void }) {
  const queued: ServerMessage[] = [];
  const waiting: ((message: ServerMessage) => void)[] = [];
  socket.on('message', (raw) => {
    const message = ServerMessageSchema.parse(JSON.parse(raw.toString()));
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queued.push(message);
  });
  return {
    next: () => queued.length > 0
      ? Promise.resolve(queued.shift()!)
      : new Promise<ServerMessage>((resolve) => waiting.push(resolve)),
    until: async (type: ServerMessage['type']) => {
      for (;;) {
        const message = await (queued.length > 0
          ? Promise.resolve(queued.shift()!)
          : new Promise<ServerMessage>((resolve) => waiting.push(resolve)));
        if (message.type === type) return message;
      }
    },
  };
}

describe('task routes', () => {
  it('creates, loads, replays, and mints a typed voice client secret', async () => {
    const { app } = await appWith();
    const created = await create(app);
    const taskId = created.snapshot.task.id;

    const loaded = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    expect(CreateTaskResponseSchema.parse(loaded.json()).snapshot.task.id).toBe(taskId);
    const replay = await app.inject({ method: 'GET', url: `/tasks/${taskId}/events?after=1` });
    expect(replay.json()).toMatchObject({ kind: 'replay' });
    const resync = await app.inject({ method: 'GET', url: `/tasks/${taskId}/events?after=999` });
    expect(resync.json()).toEqual({ kind: 'resync_required' });

    const secret = await app.inject({ method: 'POST', url: '/voice/client-secret', payload: {} });
    expect(CreateVoiceClientSecretResponseSchema.parse(secret.json()).clientSecret).toBe('ephemeral-secret');
    const impersonation = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { actorId: 'other-user', title: 'No', turn: { mode: 'typing', text: 'No' } },
    });
    expect(impersonation.statusCode).toBe(400);
  });

  it('subscribes to a task and cancels it over the WebSocket', async () => {
    const { app } = await appWith(new BlockingAgent());
    const created = await create(app);
    const taskId = created.snapshot.task.id;
    const socket = await app.injectWS('/ws');
    const stream = messages(socket);
    socket.send(JSON.stringify({ type: 'task.subscribe', taskId, afterEventId: null }));
    expect((await stream.until('task.snapshot')).type).toBe('task.snapshot');
    const command = JSON.stringify({ type: 'task.cancel', taskId, commandId: 'cancel-1' });
    socket.send(command);
    socket.send(command);
    const cancelled = await stream.until('task.cancelled');
    expect(cancelled).toMatchObject({ type: 'task.cancelled', commandId: 'cancel-1' });
    expect(await stream.until('task.cancelled')).toMatchObject({ commandId: 'cancel-1' });
    socket.close();

    const reconnect = await app.injectWS('/ws');
    const resumed = messages(reconnect);
    reconnect.send(JSON.stringify({ type: 'task.subscribe', taskId, afterEventId: '999' }));
    expect(await resumed.until('resync_required')).toEqual({ type: 'resync_required', taskId });
    reconnect.close();
  });

  it('follows a sensitive task through approval and completion', async () => {
    const { app } = await appWith(new SensitiveAgent());
    const created = await create(app);
    const taskId = created.snapshot.task.id;
    const socket = await app.injectWS('/ws');
    const stream = messages(socket);
    socket.send(JSON.stringify({ type: 'task.subscribe', taskId, afterEventId: null }));
    const snapshot = await stream.until('task.snapshot');
    const pending = snapshot.type === 'task.snapshot' ? snapshot.snapshot.pendingApproval : null;
    const required = pending ? null : await stream.until('approval.required');
    const approvalId = pending?.id ?? (required?.type === 'approval.required' ? required.approval.id : '');
    socket.send(JSON.stringify({
      type: 'approval.resolve',
      taskId,
      approvalId,
      decision: 'approve',
      commandId: 'approve-1',
    }));
    expect(await stream.until('approval.resolved')).toMatchObject({
      type: 'approval.resolved',
      commandId: 'approve-1',
    });
    expect((await stream.until('task.completed')).type).toBe('task.completed');
    socket.close();
  });
});
