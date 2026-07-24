import type { ProposedAction } from '../domain.js';

export type ActionRiskLevel = 'safe' | 'sensitive';

export interface ActionRiskAssessment {
  readonly level: ActionRiskLevel;
  readonly reasons: readonly string[];
}

export interface EvaluateActionsInput {
  readonly taskId: string;
  readonly turnId: string;
  readonly actions: readonly ProposedAction[];
}

/**
 * Inspects a read-only plan's proposed actions and decides whether
 * execution may proceed automatically (`safe`) or must pause in
 * `needs_input` for user approval (`sensitive`).
 *
 * Demo adapter: heuristic rules over action `kind`/`command`/`paths`
 * (`packages/executive-openai`), e.g. flagging destructive git, mass
 * deletion, credential access, or broad dependency/system changes.
 * Production adapter: a policy engine or model-backed evaluator behind the
 * same interface.
 */
export interface ActionRiskEvaluator {
  evaluate(input: EvaluateActionsInput): Promise<ActionRiskAssessment>;
}
