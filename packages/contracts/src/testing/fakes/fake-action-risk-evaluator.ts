import type { ProposedAction } from '../../domain.js';
import type {
  ActionRiskAssessment,
  ActionRiskEvaluator,
  EvaluateActionsInput,
} from '../../ports/action-risk-evaluator.js';

const SENSITIVE_COMMAND_PATTERN = /\b(rm\s+-rf|git\s+reset\s+--hard|git\s+clean\s+-fdx|sudo|curl|drop\s+table)\b/i;

function reasonFor(action: ProposedAction): string | null {
  if (action.kind === 'network') {
    return `Network access requested: ${action.summary}`;
  }
  if (action.kind === 'exec' && action.command !== undefined && SENSITIVE_COMMAND_PATTERN.test(action.command)) {
    return `Potentially destructive command: ${action.command}`;
  }
  return null;
}

/**
 * Reference {@link ActionRiskEvaluator} implementation. Simple,
 * deterministic keyword heuristics stand in for E1's real
 * heuristic/model-backed adapter: a fake north star for the
 * `safe | sensitive` contract shape, not a production risk policy.
 */
export class FakeActionRiskEvaluator implements ActionRiskEvaluator {
  async evaluate(input: EvaluateActionsInput): Promise<ActionRiskAssessment> {
    const reasons = input.actions.map(reasonFor).filter((reason): reason is string => reason !== null);
    return reasons.length > 0 ? { level: 'sensitive', reasons } : { level: 'safe', reasons: [] };
  }
}
