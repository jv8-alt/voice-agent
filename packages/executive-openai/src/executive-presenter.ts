import type {
  CodingEvent,
  ExecutivePresenter,
  ExecutiveUpdate,
  ExecutiveUpdatePhase,
  SummarizeOutcomeInput,
  SummarizeOutcomeResult,
  SummarizeProgressInput,
  TurnStatus,
} from '@voice-agent/contracts';

export interface OutcomeSummaryRequest {
  readonly status: TurnStatus;
  readonly eventCount: number;
  readonly toolCount: number;
  readonly changedFileCount: number;
  readonly failedToolCount: number;
  readonly outcome?: string;
}

export interface OutcomeSummary {
  readonly headline: string;
  readonly detail?: string;
}

/** Injected model boundary; tests can run without credentials or network. */
export interface OutcomeSummaryModel {
  summarize(request: OutcomeSummaryRequest): Promise<OutcomeSummary>;
}

const STATUS_PHASE = {
  queued: 'working',
  working: 'working',
  needs_input: 'needs_input',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const satisfies Record<TurnStatus, ExecutiveUpdatePhase>;

const FALLBACK_HEADLINE = {
  queued: 'Preparing your task',
  working: 'Work is still in progress',
  needs_input: 'Your approval is needed',
  completed: 'Your task is complete',
  failed: 'The task could not be completed',
  cancelled: 'The task was cancelled',
} as const satisfies Record<TurnStatus, string>;

function eventFacts(events: readonly CodingEvent[]) {
  const tools = new Set<string>();
  const files = new Set<string>();
  let failedToolCount = 0;
  for (const event of events) {
    if (event.type === 'tool_started' || event.type === 'tool_finished') tools.add(event.tool);
    if (event.type === 'tool_finished' && !event.ok) failedToolCount += 1;
    if (event.type === 'plan_ready') {
      for (const action of event.actions) for (const path of action.paths ?? []) files.add(path);
    }
  }
  return { tools: [...tools], files: [...files], failedToolCount };
}

function outcomeCandidate(events: readonly CodingEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'completed') {
      const summary = event.summary.trim();
      return summary ? summary.slice(0, 2_000) : undefined;
    }
  }
  return undefined;
}

function privateStrings(events: readonly CodingEvent[]): string[] {
  const values: string[] = [];
  for (const event of events) {
    if (event.type === 'message') values.push(event.text);
    if (event.type === 'completed') values.push(event.summary);
    if (event.type === 'tool_started' || event.type === 'tool_finished') values.push(event.tool, event.summary);
    if (event.type === 'failed') values.push(event.error.message);
    if (event.type === 'plan_ready') {
      for (const action of event.actions) values.push(action.summary, action.command ?? '', ...(action.paths ?? []));
    }
  }
  return values.filter((value) => value.length >= 4);
}

function containsPrivateText(summary: OutcomeSummary, events: readonly CodingEvent[]): boolean {
  const publicText = `${summary.headline}\n${summary.detail ?? ''}`.toLowerCase();
  return privateStrings(events).some((value) => publicText.includes(value.toLowerCase()));
}

export class OpenAIExecutivePresenter implements ExecutivePresenter {
  constructor(
    private readonly model: OutcomeSummaryModel,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async summarizeProgress(input: SummarizeProgressInput): Promise<ExecutiveUpdate> {
    const hasPlan = input.events.some((event) => event.type === 'plan_ready');
    const hasWork = input.events.some((event) => event.type === 'tool_started' || event.type === 'tool_finished');
    return {
      taskId: input.taskId,
      turnId: input.turnId,
      phase: hasPlan && !hasWork ? 'understood' : 'working',
      headline: hasPlan && !hasWork ? 'I understand the task' : 'Working on your task',
      createdAt: this.now().toISOString(),
    };
  }

  async summarizeOutcome(input: SummarizeOutcomeInput): Promise<SummarizeOutcomeResult> {
    const facts = eventFacts(input.events);
    const outcome = outcomeCandidate(input.events);
    let generated: OutcomeSummary;
    try {
      generated = await this.model.summarize({
        status: input.status,
        eventCount: input.events.length,
        toolCount: facts.tools.length,
        changedFileCount: facts.files.length,
        failedToolCount: facts.failedToolCount,
        ...(outcome === undefined ? {} : { outcome }),
      });
    } catch {
      generated = { headline: FALLBACK_HEADLINE[input.status] };
    }
    const summary = containsPrivateText(generated, input.events)
      ? { headline: FALLBACK_HEADLINE[input.status] }
      : generated;
    const createdAt = this.now().toISOString();
    return {
      update: {
        taskId: input.taskId,
        turnId: input.turnId,
        phase: STATUS_PHASE[input.status],
        headline: summary.headline,
        ...(summary.detail === undefined ? {} : { detail: summary.detail }),
        createdAt,
      },
      technicalSummary: {
        taskId: input.taskId,
        turnId: input.turnId,
        narrative: `Processed ${input.events.length} normalized events; final status: ${input.status}.`,
        toolsUsed: facts.tools,
        filesTouched: facts.files,
        createdAt,
      },
    };
  }
}
