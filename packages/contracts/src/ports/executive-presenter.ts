import type { CodingEvent, ExecutiveUpdate, TechnicalSummary } from '../domain.js';
import type { TaskStatus } from '../status.js';

export interface SummarizeProgressInput {
  readonly taskId: string;
  readonly turnId: string;
  readonly events: readonly CodingEvent[];
}

export interface SummarizeOutcomeInput {
  readonly taskId: string;
  readonly turnId: string;
  readonly events: readonly CodingEvent[];
  readonly status: TaskStatus;
}

export interface SummarizeOutcomeResult {
  readonly update: ExecutiveUpdate;
  readonly technicalSummary: TechnicalSummary;
}

/**
 * Collapses private, technical {@link CodingEvent}s into the coarse
 * executive updates the browser is allowed to see, and produces the
 * private {@link TechnicalSummary} kept for internal record-keeping. Raw
 * agent/tool output must never leak past this boundary.
 *
 * Demo adapter: OpenAI Agents SDK structured output for outcome summaries,
 * with deterministic phase labels for intermediate progress to avoid a
 * model call per event (`packages/executive-openai`). Production adapter:
 * the same or a different summarization model behind this port.
 */
export interface ExecutivePresenter {
  summarizeProgress(input: SummarizeProgressInput): Promise<ExecutiveUpdate>;
  summarizeOutcome(input: SummarizeOutcomeInput): Promise<SummarizeOutcomeResult>;
}
