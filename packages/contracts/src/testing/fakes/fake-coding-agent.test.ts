import { describe, expect, it } from 'vitest';
import { runCodingAgentConformance } from '../../conformance/coding-agent.js';
import type { WorkspaceLease } from '../../ports/workspace-provider.js';
import { FakeCodingAgent } from './fake-coding-agent.js';

runCodingAgentConformance((scenario) => new FakeCodingAgent(scenario));

describe('FakeCodingAgent (extra scenario checks)', () => {
  const workspace: WorkspaceLease = { leaseId: 'lease-1', rootPath: '/tmp/lease-1' };

  it('run() emits a completed event in the success scenario', async () => {
    const agent = new FakeCodingAgent('success');
    const controller = new AbortController();
    const events = [];
    for await (const event of agent.run({
      taskId: 'task-1',
      turnId: 'turn-1',
      workspace,
      signal: controller.signal,
      agentThreadId: 'thread-1',
    })) {
      events.push(event);
    }
    expect(events.at(-1)).toEqual({ type: 'completed', summary: 'Fixed the checkout bug.' });
  });

  it('resume() delegates to run()', async () => {
    const agent = new FakeCodingAgent('success');
    const controller = new AbortController();
    const events = [];
    for await (const event of agent.resume({
      taskId: 'task-1',
      turnId: 'turn-1',
      workspace,
      signal: controller.signal,
      agentThreadId: 'thread-1',
      instructions: 'Continue after approval',
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === 'completed')).toBe(true);
  });
});
