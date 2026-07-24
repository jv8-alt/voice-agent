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
        'Write a concrete, calm response for the person who made the request. If the outcome answers an ' +
        'informational question, put the direct answer in the headline (never “analysis completed” or similar) ' +
        'and do not imply code changed or tests ran. ' +
        'If work was requested, lead with what changed or was fixed and use the detail for verification or a caveat. ' +
        'Never substitute internal event, tool, or planned-file counts for the requested answer. Do not repeat raw logs, commands, ' +
        'absolute paths, credentials, tokens, or other private data. Mention tests only when the outcome explicitly ' +
        'says they ran. Return one short headline and optional detail.',
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
