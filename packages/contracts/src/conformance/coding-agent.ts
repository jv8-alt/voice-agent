import { describe, expect, it } from 'vitest';
import { CodingEventSchema } from '../domain.js';
import type { CodingAgent } from '../ports/coding-agent.js';
import type { WorkspaceLease } from '../ports/workspace-provider.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

const workspace: WorkspaceLease = { leaseId: 'lease-1', rootPath: '/tmp/workspace-fixture-lease-1' };

/**
 * Conformance suite for {@link CodingAgent}. Because this port's real
 * behavior is inherently scenario-dependent (a successful plan, an
 * aborted run, an unavailable dependency), the factory takes a scenario
 * tag rather than being a plain zero-argument constructor like the other
 * conformance suites — a fake or adapter under test decides how to react
 * to each named scenario.
 *
 * Covers the invariants pinned in MIKADO.md that apply to this port:
 * every emitted event conforms to the normalized `CodingEvent` shape (no
 * raw SDK/tool payload ever crosses the boundary), `plan()` emits
 * `thread_ready` before `plan_ready`, an aborted signal stops the stream
 * promptly, and a dependency outage surfaces as a typed `failed` event
 * rather than a thrown error.
 */
export function runCodingAgentConformance(
  createAgent: (scenario: 'success' | 'outage') => CodingAgent | Promise<CodingAgent>,
): void {
  describe('CodingAgent conformance', () => {
    it('plan() emits thread_ready before plan_ready, and every event validates', async () => {
      const agent = await createAgent('success');
      const controller = new AbortController();
      const events = await collect(
        agent.plan({ taskId: 'task-1', turnId: 'turn-1', workspace, signal: controller.signal, instructions: 'Fix it' }),
      );

      for (const event of events) {
        expect(CodingEventSchema.safeParse(event).success).toBe(true);
      }

      const threadReadyIndex = events.findIndex((event) => event.type === 'thread_ready');
      const planReadyIndex = events.findIndex((event) => event.type === 'plan_ready');
      expect(threadReadyIndex).toBeGreaterThanOrEqual(0);
      expect(planReadyIndex).toBeGreaterThan(threadReadyIndex);
    });

    it('never emits a raw, non-conforming event even when it plans successfully', async () => {
      const agent = await createAgent('success');
      const controller = new AbortController();
      const events = await collect(
        agent.plan({ taskId: 'task-1', turnId: 'turn-1', workspace, signal: controller.signal, instructions: 'Fix it' }),
      );
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => CodingEventSchema.safeParse(event).success)).toBe(true);
    });

    it('stops promptly when the signal is already aborted before plan() starts', async () => {
      const agent = await createAgent('success');
      const controller = new AbortController();
      controller.abort();

      const events = await collect(
        agent.plan({ taskId: 'task-1', turnId: 'turn-1', workspace, signal: controller.signal, instructions: 'Fix it' }),
      );
      expect(events.length).toBeLessThanOrEqual(1);
    });

    it('run() eventually reaches a terminal completed or failed event', async () => {
      const agent = await createAgent('success');
      const controller = new AbortController();
      const events = await collect(
        agent.run({ taskId: 'task-1', turnId: 'turn-1', workspace, signal: controller.signal, agentThreadId: 'thread-1' }),
      );
      const last = events.at(-1);
      expect(last?.type === 'completed' || last?.type === 'failed').toBe(true);
    });

    it('surfaces a dependency outage as a typed "failed" event, not a thrown error', async () => {
      const agent = await createAgent('outage');
      const controller = new AbortController();

      const events = await collect(
        agent.plan({ taskId: 'task-1', turnId: 'turn-1', workspace, signal: controller.signal, instructions: 'Fix it' }),
      );

      const failed = events.find((event) => event.type === 'failed');
      expect(failed).toBeDefined();
      expect(failed?.type === 'failed' ? failed.error.code : undefined).toBe('dependency_unavailable');
    });
  });
}
