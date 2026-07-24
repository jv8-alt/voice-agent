import type { CodingEvent } from '../../domain.js';
import { dependencyUnavailableError } from '../../errors.js';
import type { CodingAgent, PlanInput, ResumeInput, RunInput } from '../../ports/coding-agent.js';

export type FakeCodingAgentScenario = 'success' | 'outage';

/**
 * Reference {@link CodingAgent} implementation. Scripted rather than
 * running any real model or tool: `'success'` emits a minimal
 * plan/run/complete sequence, `'outage'` emits a typed `failed` event
 * with `dependency_unavailable` instead of throwing, and every method
 * checks `signal.aborted` between steps so cancellation stops the stream
 * promptly, per the port's documented contract.
 */
export class FakeCodingAgent implements CodingAgent {
  constructor(private readonly scenario: FakeCodingAgentScenario = 'success') {}

  async *plan(input: PlanInput): AsyncIterable<CodingEvent> {
    if (input.signal.aborted) return;
    yield { type: 'thread_ready', threadId: 'fake-thread-1' };

    if (input.signal.aborted) return;
    if (this.scenario === 'outage') {
      yield { type: 'failed', error: dependencyUnavailableError('Fake dependency outage during planning.').toProblem() };
      return;
    }
    yield {
      type: 'plan_ready',
      actions: [{ kind: 'read', summary: 'Inspect the repository for the requested fix.' }],
    };
  }

  async *run(input: RunInput): AsyncIterable<CodingEvent> {
    if (input.signal.aborted) return;
    yield { type: 'tool_started', tool: 'apply_patch', summary: 'Applying the fix' };

    if (input.signal.aborted) return;
    if (this.scenario === 'outage') {
      yield { type: 'failed', error: dependencyUnavailableError('Fake dependency outage during run.').toProblem() };
      return;
    }
    yield { type: 'tool_finished', tool: 'apply_patch', summary: 'Applied the fix', ok: true };
    yield { type: 'completed', summary: 'Fixed the checkout bug.' };
  }

  async *resume(input: ResumeInput): AsyncIterable<CodingEvent> {
    yield* this.run(input);
  }
}
