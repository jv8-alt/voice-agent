import { beforeEach, describe, expect, it } from 'vitest';
import { ExecutiveUpdatePhaseSchema, ExecutiveUpdateSchema, TechnicalSummarySchema, type CodingEvent } from '../domain.js';
import type { ExecutivePresenter } from '../ports/executive-presenter.js';

const sampleEvents: readonly CodingEvent[] = [
  { type: 'thread_ready', threadId: 'thread-1' },
  { type: 'plan_ready', actions: [{ kind: 'write', summary: 'Edit checkout.ts' }] },
  { type: 'tool_started', tool: 'apply_patch', summary: 'Editing checkout.ts' },
  { type: 'tool_finished', tool: 'apply_patch', summary: 'Edited checkout.ts', ok: true },
];

/**
 * Conformance suite for {@link ExecutivePresenter}. Because the real
 * demo adapter calls a summarization model, this suite only checks the
 * invariants that must hold regardless of the model: every produced
 * update/summary validates against its pinned schema, and the coarse
 * `ExecutiveUpdatePhase` mapping in `summarizeOutcome` agrees with the
 * `TurnStatus` it was given (the "raw agent/tool output must never leak
 * past this boundary" property is a semantic guarantee of the real
 * model-backed adapter and is out of scope for a structural conformance
 * suite; E1 verifies it against the concrete adapter).
 */
export function runExecutivePresenterConformance(
  createPresenter: () => ExecutivePresenter | Promise<ExecutivePresenter>,
): void {
  describe('ExecutivePresenter conformance', () => {
    let presenter: ExecutivePresenter;

    beforeEach(async () => {
      presenter = await createPresenter();
    });

    it('summarizeProgress() returns a schema-valid ExecutiveUpdate', async () => {
      const update = await presenter.summarizeProgress({ taskId: 'task-1', turnId: 'turn-1', events: sampleEvents });
      expect(ExecutiveUpdateSchema.safeParse(update).success).toBe(true);
    });

    it.each([
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
    ] as const)('summarizeOutcome() maps TurnStatus "%s" to executive phase "%s"', async (status, phase) => {
      const result = await presenter.summarizeOutcome({ taskId: 'task-1', turnId: 'turn-1', events: sampleEvents, status });
      expect(ExecutiveUpdatePhaseSchema.safeParse(result.update.phase).success).toBe(true);
      expect(result.update.phase).toBe(phase);
      expect(TechnicalSummarySchema.safeParse(result.technicalSummary).success).toBe(true);
    });

    it('summarizeOutcome() result validates end to end against both pinned schemas', async () => {
      const result = await presenter.summarizeOutcome({
        taskId: 'task-1',
        turnId: 'turn-1',
        events: sampleEvents,
        status: 'completed',
      });
      expect(ExecutiveUpdateSchema.safeParse(result.update).success).toBe(true);
      expect(TechnicalSummarySchema.safeParse(result.technicalSummary).success).toBe(true);
    });
  });
}
