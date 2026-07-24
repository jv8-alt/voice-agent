import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import type { OutcomeSummary, OutcomeSummaryModel, OutcomeSummaryRequest } from './executive-presenter.js';

const OutcomeSummarySchema = z.object({
  headline: z.string().min(1).max(80),
  detail: z.string().min(1).max(180).optional(),
});

export interface OpenAIOutcomeSummaryModelOptions {
  readonly model?: string;
}

/**
 * Agents SDK-backed summarizer. It receives counts and final state only:
 * raw messages, commands, paths, and tool output never enter the model prompt.
 */
export class OpenAIOutcomeSummaryModel implements OutcomeSummaryModel {
  private readonly agent: Agent<unknown, typeof OutcomeSummarySchema>;

  constructor(options: OpenAIOutcomeSummaryModelOptions = {}) {
    this.agent = new Agent({
      name: 'Executive outcome presenter',
      model: options.model ?? 'gpt-4.1-mini',
      instructions:
        'Write a calm, plain-language task outcome. Return one short headline and optional detail. ' +
        'Do not invent filenames, commands, logs, tools, technical diagnostics, or private data.',
      outputType: OutcomeSummarySchema,
    });
  }

  async summarize(request: OutcomeSummaryRequest): Promise<OutcomeSummary> {
    const result = await run(this.agent, JSON.stringify(request));
    if (result.finalOutput === undefined) throw new Error('The summary model returned no structured output.');
    return result.finalOutput.detail === undefined
      ? { headline: result.finalOutput.headline }
      : { headline: result.finalOutput.headline, detail: result.finalOutput.detail };
  }
}
