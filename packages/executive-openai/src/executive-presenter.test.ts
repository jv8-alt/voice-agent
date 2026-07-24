import type { CodingEvent } from '@voice-agent/contracts';
import { runExecutivePresenterConformance } from '@voice-agent/contracts/conformance';
import { describe, expect, it } from 'vitest';
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

  it('replaces a model response that repeats private event data', async () => {
    const model = new FakeSummaryModel({ headline: 'raw tool output', detail: 'RAW_LOG_TOKEN=sk-private-value' });
    const presenter = new OpenAIExecutivePresenter(model);
    const result = await presenter.summarizeOutcome({
      taskId: 'task-1',
      turnId: 'turn-1',
      status: 'completed',
      events: privateEvents,
    });
    expect(result.update).toMatchObject({ phase: 'completed', headline: 'Your task is complete' });
    expect(JSON.stringify(result.update)).not.toMatch(/RAW_LOG_TOKEN|raw tool output/);
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
