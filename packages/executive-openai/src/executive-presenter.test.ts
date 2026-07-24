import type { CodingEvent } from '@voice-agent/contracts';
import { runExecutivePresenterConformance } from '@voice-agent/contracts/conformance';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenAIExecutivePresenter,
  type OutcomeSummary,
  type OutcomeSummaryModel,
  type OutcomeSummaryRequest,
} from './executive-presenter.js';

class FakeSummaryModel implements OutcomeSummaryModel {
  requests: OutcomeSummaryRequest[] = [];

  constructor(private readonly output: OutcomeSummary = { headline: 'Finished successfully' }) {}

  async summarize(request: OutcomeSummaryRequest): Promise<OutcomeSummary> {
    this.requests.push(request);
    return this.output;
  }
}

runExecutivePresenterConformance(
  () => new OpenAIExecutivePresenter(new FakeSummaryModel(), () => new Date('2026-07-24T12:00:00.000Z')),
);

describe('OpenAIExecutivePresenter', () => {
  const privateEvents: readonly CodingEvent[] = [
    { type: 'message', text: 'RAW_LOG_TOKEN=sk-private-value' },
    {
      type: 'plan_ready',
      actions: [{ kind: 'exec', summary: 'Run private command', command: 'secret-command --token abc', paths: ['private/file.ts'] }],
    },
    { type: 'tool_started', tool: 'private_tool', summary: 'raw tool input' },
    { type: 'tool_finished', tool: 'private_tool', summary: 'raw tool output', ok: true },
  ];

  it('sends only aggregate facts to the injected model', async () => {
    const model = new FakeSummaryModel();
    const presenter = new OpenAIExecutivePresenter(model);
    await presenter.summarizeOutcome({
      taskId: 'task-1',
      turnId: 'turn-1',
      status: 'completed',
      events: privateEvents,
    });
    expect(model.requests).toEqual([
      { status: 'completed', eventCount: 4, toolCount: 1, changedFileCount: 1, failedToolCount: 0 },
    ]);
    expect(JSON.stringify(model.requests)).not.toMatch(/RAW_LOG_TOKEN|secret-command|private_tool|private\/file/);
  });

  it('gives the model the final outcome so the public update can describe the result', async () => {
    const model = new FakeSummaryModel({
      headline: 'Checkout retries now recover correctly',
      detail: 'The targeted tests pass.',
    });
    const presenter = new OpenAIExecutivePresenter(model);
    const result = await presenter.summarizeOutcome({
      taskId: 'task-1',
      turnId: 'turn-1',
      status: 'completed',
      events: [
        {
          type: 'completed',
          summary: 'Implemented retry recovery for checkout and ran the targeted test suite successfully.',
        },
      ],
    });

    expect(model.requests[0]?.outcome).toContain('Implemented retry recovery');
    expect(result.update).toMatchObject({
      headline: 'Checkout retries now recover correctly',
      detail: 'The targeted tests pass.',
    });
  });

  it('case-insensitively replaces a model response that repeats private event data', async () => {
    const model = new FakeSummaryModel({ headline: 'RAW TOOL OUTPUT', detail: 'raw_log_token=SK-PRIVATE-VALUE' });
    const presenter = new OpenAIExecutivePresenter(model);
    const result = await presenter.summarizeOutcome({
      taskId: 'task-1',
      turnId: 'turn-1',
      status: 'completed',
      events: privateEvents,
    });
    expect(result.update).toMatchObject({ phase: 'completed', headline: 'Your task is complete' });
    expect(JSON.stringify(result.update)).not.toMatch(/raw_log_token|raw tool output/i);
  });

  it('keeps completed work completed when the summary model is unavailable', async () => {
    const presenter = new OpenAIExecutivePresenter({
      summarize: vi.fn().mockRejectedValue(new Error('Summary model unavailable')),
    });
    const result = await presenter.summarizeOutcome({
      taskId: 'task-1',
      turnId: 'turn-1',
      status: 'completed',
      events: [{ type: 'completed', summary: 'Answered the follow-up.' }],
    });

    expect(result.update).toMatchObject({
      phase: 'completed',
      headline: 'Your task is complete',
    });
  });

  it('uses fixed, non-technical progress language', async () => {
    const presenter = new OpenAIExecutivePresenter(new FakeSummaryModel());
    const update = await presenter.summarizeProgress({
      taskId: 'task-1',
      turnId: 'turn-1',
      events: privateEvents,
    });
    expect(update.headline).toBe('Working on your task');
    expect(JSON.stringify(update)).not.toMatch(/private_tool|raw tool input|raw tool output/);
  });
});
