import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ThreadEvent, ThreadOptions, TurnOptions } from '@openai/codex-sdk';
import { runCodingAgentConformance } from '@voice-agent/contracts/conformance';
import type { WorkspaceLease } from '@voice-agent/contracts';
import { FixtureWorkspaceProvider } from '@voice-agent/workspace-fixture';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodexCodingAgent,
  type CodexClient,
  type CodexThread,
} from './codex-coding-agent.js';

const execFileAsync = promisify(execFile);
const planResponse = JSON.stringify({
  actions: [
    {
      kind: 'read',
      summary: 'Inspect the greeting implementation',
      paths: ['src/greeting.js'],
      command: null,
    },
    {
      kind: 'write',
      summary: 'Update the greeting implementation',
      paths: ['src/greeting.js'],
      command: null,
    },
    {
      kind: 'exec',
      summary: 'Run the fixture tests',
      paths: null,
      command: 'npm test',
    },
  ],
});

async function* successfulEvents(plan: boolean): AsyncGenerator<ThreadEvent> {
  if (plan) {
    yield { type: 'thread.started', thread_id: 'thread-1' };
    yield { type: 'turn.started' };
    yield {
      type: 'item.completed',
      item: { id: 'message-1', type: 'agent_message', text: planResponse },
    };
    yield {
      type: 'turn.completed',
      usage: {
        input_tokens: 1,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      },
    };
    return;
  }

  yield {
    type: 'item.started',
    item: {
      id: 'command-1',
      type: 'command_execution',
      command: 'npm test',
      aggregated_output: '',
      status: 'in_progress',
    },
  };
  yield {
    type: 'item.completed',
    item: {
      id: 'command-1',
      type: 'command_execution',
      command: 'npm test',
      aggregated_output: 'pass',
      exit_code: 0,
      status: 'completed',
    },
  };
  yield {
    type: 'item.completed',
    item: { id: 'message-2', type: 'agent_message', text: 'Implemented the change and tests pass.' },
  };
  yield {
    type: 'turn.completed',
    usage: {
      input_tokens: 1,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    },
  };
}

class FakeThread implements CodexThread {
  constructor(
    private readonly outage: boolean,
    private readonly beforeStream?: (() => Promise<void>) | undefined,
  ) {}

  async runStreamed(
    _input: string,
    options?: TurnOptions,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    await this.beforeStream?.();
    if (this.outage) {
      return {
        events: (async function* () {
          yield { type: 'error', message: 'Codex unavailable' };
        })(),
      };
    }
    return { events: successfulEvents(options?.outputSchema !== undefined) };
  }
}

class FakeCodexClient implements CodexClient {
  readonly starts: ThreadOptions[] = [];
  readonly resumes: Array<{ id: string; options: ThreadOptions }> = [];

  constructor(
    private readonly outage = false,
    private readonly beforeExecute?: (() => Promise<void>) | undefined,
  ) {}

  startThread(options: ThreadOptions = {}): CodexThread {
    this.starts.push(options);
    return new FakeThread(this.outage);
  }

  resumeThread(id: string, options: ThreadOptions = {}): CodexThread {
    this.resumes.push({ id, options });
    return new FakeThread(this.outage, this.beforeExecute);
  }
}

class ThrowingCodexClient implements CodexClient {
  startThread(): CodexThread {
    throw new Error('Codex process failed to start');
  }

  resumeThread(): CodexThread {
    throw new Error('Codex session provider failed');
  }
}

runCodingAgentConformance((scenario) => (
  new CodexCodingAgent({ client: new FakeCodexClient(scenario === 'outage') })
));

const controllers: AbortController[] = [];
afterEach(() => {
  for (const controller of controllers) controller.abort();
  controllers.length = 0;
});

function input(workspace: WorkspaceLease) {
  const controller = new AbortController();
  controllers.push(controller);
  return {
    taskId: 'task-1',
    turnId: 'turn-1',
    workspace,
    signal: controller.signal,
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe('CodexCodingAgent', () => {
  const workspace = { leaseId: 'lease-1', rootPath: '/tmp/codex-workspace' };
  const invalidWorkspace = { leaseId: 'lease-invalid', rootPath: 'relative/workspace' };

  function expectInvalidInput(events: Awaited<ReturnType<typeof collect>>) {
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'failed',
      error: {
        code: 'invalid_input',
        retryable: false,
        message: 'Workspace rootPath must be an absolute normalized path',
      },
    });
  }

  it('preserves invalid_input for an invalid planning workspace root', async () => {
    const client = new FakeCodexClient();
    const agent = new CodexCodingAgent({ client });

    const events = await collect(agent.plan({
      ...input(invalidWorkspace),
      instructions: 'Improve the greeting',
    }));

    expectInvalidInput(events);
    expect(client.starts).toHaveLength(0);
  });

  it('preserves invalid_input for an invalid run workspace root', async () => {
    const client = new FakeCodexClient();
    const agent = new CodexCodingAgent({ client });

    const events = await collect(agent.run({
      ...input(invalidWorkspace),
      agentThreadId: 'thread-1',
    }));

    expectInvalidInput(events);
    expect(client.resumes).toHaveLength(0);
  });

  it('preserves invalid_input for an invalid resume workspace root', async () => {
    const client = new FakeCodexClient();
    const agent = new CodexCodingAgent({ client });

    const events = await collect(agent.resume({
      ...input(invalidWorkspace),
      agentThreadId: 'thread-1',
      instructions: 'Add another test',
    }));

    expectInvalidInput(events);
    expect(client.resumes).toHaveLength(0);
  });

  it('still normalizes untyped Codex provider failures as retryable dependency outages', async () => {
    const agent = new CodexCodingAgent({ client: new ThrowingCodexClient() });

    const planEvents = await collect(agent.plan({
      ...input(workspace),
      instructions: 'Improve the greeting',
    }));
    const runEvents = await collect(agent.run({
      ...input(workspace),
      agentThreadId: 'thread-1',
    }));

    for (const events of [planEvents, runEvents]) {
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'failed',
        error: { code: 'dependency_unavailable', retryable: true },
      });
    }
  });

  it('plans in a read-only, offline thread and returns normalized actions', async () => {
    const client = new FakeCodexClient();
    const agent = new CodexCodingAgent({ client });

    const events = await collect(agent.plan({ ...input(workspace), instructions: 'Improve the greeting' }));

    expect(client.starts).toEqual([
      expect.objectContaining({
        workingDirectory: workspace.rootPath,
        sandboxMode: 'read-only',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
        approvalPolicy: 'never',
      }),
    ]);
    expect(events.at(0)).toEqual({ type: 'thread_ready', threadId: 'thread-1' });
    expect(events.at(-1)).toMatchObject({
      type: 'plan_ready',
      actions: expect.arrayContaining([expect.objectContaining({ kind: 'read' })]),
    });
  });

  it('runs and resumes an existing thread with workspace-write and no network', async () => {
    const client = new FakeCodexClient();
    const agent = new CodexCodingAgent({ client });

    await collect(agent.run({ ...input(workspace), agentThreadId: 'thread-1' }));
    await collect(agent.resume({
      ...input(workspace),
      turnId: 'turn-2',
      agentThreadId: 'thread-1',
      instructions: 'Add another test',
    }));

    expect(client.resumes).toHaveLength(2);
    expect(client.resumes).toEqual([
      { id: 'thread-1', options: expect.objectContaining({ sandboxMode: 'workspace-write', networkAccessEnabled: false }) },
      { id: 'thread-1', options: expect.objectContaining({ sandboxMode: 'workspace-write', networkAccessEnabled: false }) },
    ]);
  });

  it('executes the bundled fixture test inside its disposable lease', async () => {
    const provider = new FixtureWorkspaceProvider();
    const lease = await provider.acquire({ taskId: 'codex-test', workspaceId: 'demo-repo' });
    const client = new FakeCodexClient(false, async () => {
      const { stdout } = await execFileAsync(process.execPath, ['--test'], { cwd: lease.rootPath });
      expect(stdout).toContain('pass 1');
    });
    const agent = new CodexCodingAgent({ client });

    const events = await collect(agent.run({ ...input(lease), agentThreadId: 'thread-1' }));

    expect(events.at(-1)?.type).toBe('completed');
    await provider.release(lease.leaseId);
  });

  it('stops without a failure event when aborted mid-stream', async () => {
    const agent = new CodexCodingAgent({ client: new FakeCodexClient() });
    const controller = new AbortController();
    const iterator = agent.run({
      taskId: 'task-1',
      turnId: 'turn-1',
      workspace,
      signal: controller.signal,
      agentThreadId: 'thread-1',
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'tool_started' } });
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('fails the run when a command finishes with status failed or a non-zero exit code', async () => {
    async function* failedCommandEvents(): AsyncGenerator<ThreadEvent> {
      yield {
        type: 'item.completed',
        item: {
          id: 'command-failed',
          type: 'command_execution',
          command: 'npm test',
          aggregated_output: 'fail',
          exit_code: 1,
          status: 'failed',
        },
      };
      yield {
        type: 'item.completed',
        item: { id: 'message-failed', type: 'agent_message', text: 'Tests failed.' },
      };
      yield {
        type: 'turn.completed',
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      };
    }

    async function* nonzeroExitEvents(): AsyncGenerator<ThreadEvent> {
      yield {
        type: 'item.completed',
        item: {
          id: 'command-nonzero',
          type: 'command_execution',
          command: 'npm test',
          aggregated_output: 'fail',
          exit_code: 2,
          status: 'completed',
        },
      };
      yield {
        type: 'turn.completed',
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      };
    }

    for (const events of [failedCommandEvents, nonzeroExitEvents]) {
      const client: CodexClient = {
        startThread() {
          throw new Error('unused');
        },
        resumeThread() {
          return {
            async runStreamed() {
              return { events: events() };
            },
          };
        },
      };
      const agent = new CodexCodingAgent({ client });
      const collected = await collect(agent.run({ ...input(workspace), agentThreadId: 'thread-1' }));

      expect(collected).toContainEqual(
        expect.objectContaining({ type: 'tool_finished', tool: 'command', ok: false }),
      );
      expect(collected.at(-1)).toMatchObject({
        type: 'failed',
        error: { code: 'internal', retryable: false },
      });
    }
  });
});
