import { beforeEach, describe, expect, it } from 'vitest';
import type { ProposedAction } from '../domain.js';
import type { ActionRiskEvaluator } from '../ports/action-risk-evaluator.js';

const readOnlyAction: ProposedAction = { kind: 'read', summary: 'Read checkout.ts' };
const destructiveAction: ProposedAction = {
  kind: 'exec',
  summary: 'Force-delete the git history',
  command: 'git reset --hard && git clean -fdx',
};

/**
 * Conformance suite for {@link ActionRiskEvaluator}. The exact heuristic
 * or model behind `evaluate()` is adapter-specific (E1's job), so this
 * suite only pins the structural contract: the result validates against
 * the frozen `safe | sensitive` vocabulary, a purely read-only plan is
 * never flagged `sensitive`, and every `sensitive` assessment carries at
 * least one human-readable reason (so `approval.required` always has
 * something to show the user).
 */
export function runActionRiskEvaluatorConformance(
  createEvaluator: () => ActionRiskEvaluator | Promise<ActionRiskEvaluator>,
): void {
  describe('ActionRiskEvaluator conformance', () => {
    let evaluator: ActionRiskEvaluator;

    beforeEach(async () => {
      evaluator = await createEvaluator();
    });

    it('returns a schema-valid level for a read-only plan', async () => {
      const result = await evaluator.evaluate({ taskId: 'task-1', turnId: 'turn-1', actions: [readOnlyAction] });
      expect(['safe', 'sensitive']).toContain(result.level);
    });

    it('never flags a purely read-only plan as sensitive', async () => {
      const result = await evaluator.evaluate({ taskId: 'task-1', turnId: 'turn-1', actions: [readOnlyAction] });
      expect(result.level).toBe('safe');
    });

    it('classifies a pinned destructive command as sensitive with a reason', async () => {
      const result = await evaluator.evaluate({ taskId: 'task-1', turnId: 'turn-1', actions: [destructiveAction] });
      expect(result.level).toBe('sensitive');
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('is deterministic for the same input', async () => {
      const first = await evaluator.evaluate({ taskId: 'task-1', turnId: 'turn-1', actions: [destructiveAction] });
      const second = await evaluator.evaluate({ taskId: 'task-1', turnId: 'turn-1', actions: [destructiveAction] });
      expect(second.level).toBe(first.level);
    });
  });
}
