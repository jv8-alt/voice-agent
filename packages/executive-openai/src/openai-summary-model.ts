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

/** Agents SDK-backed summarizer for a concise, user-facing outcome. */
export class OpenAIOutcomeSummaryModel implements OutcomeSummaryModel {
  private readonly agent: Agent<unknown, typeof OutcomeSummarySchema>;

  constructor(options: OpenAIOutcomeSummaryModelOptions = {}) {
    this.agent = new Agent({
      name: 'Executive outcome presenter',
      model: options.model ?? 'gpt-4.1-mini',
      instructions:
        'Write a concrete, calm task outcome for the person who requested the work. ' +
        'Lead with what changed or was fixed, and use the detail for verification or an important caveat. ' +
        'Never report event, tool, or file counts as the outcome. Do not repeat raw logs, commands, ' +
        'absolute paths, credentials, tokens, or other private data. Return one short headline and optional detail.',
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
