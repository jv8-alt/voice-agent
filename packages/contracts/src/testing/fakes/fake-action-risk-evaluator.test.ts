import { describe, expect, it } from 'vitest';
import { runActionRiskEvaluatorConformance } from '../../conformance/action-risk-evaluator.js';
import { FakeActionRiskEvaluator } from './fake-action-risk-evaluator.js';

runActionRiskEvaluatorConformance(() => new FakeActionRiskEvaluator());

describe('FakeActionRiskEvaluator (extra heuristic checks)', () => {
  it('flags a destructive git command as sensitive', async () => {
    const evaluator = new FakeActionRiskEvaluator();
    const result = await evaluator.evaluate({
      taskId: 'task-1',
      turnId: 'turn-1',
      actions: [{ kind: 'exec', summary: 'Reset git state', command: 'git reset --hard' }],
    });
    expect(result.level).toBe('sensitive');
  });

  it('flags network actions as sensitive', async () => {
    const evaluator = new FakeActionRiskEvaluator();
    const result = await evaluator.evaluate({
      taskId: 'task-1',
      turnId: 'turn-1',
      actions: [{ kind: 'network', summary: 'Fetch an external URL' }],
    });
    expect(result.level).toBe('sensitive');
  });

  it('treats a benign write as safe', async () => {
    const evaluator = new FakeActionRiskEvaluator();
    const result = await evaluator.evaluate({
      taskId: 'task-1',
      turnId: 'turn-1',
      actions: [{ kind: 'write', summary: 'Edit checkout.ts', paths: ['src/checkout.ts'] }],
    });
    expect(result.level).toBe('safe');
  });
});
