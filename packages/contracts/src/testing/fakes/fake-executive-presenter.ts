import type { CodingEvent, ExecutiveUpdate, ExecutiveUpdatePhase } from '../../domain.js';
import type {
  ExecutivePresenter,
  SummarizeOutcomeInput,
  SummarizeOutcomeResult,
  SummarizeProgressInput,
} from '../../ports/executive-presenter.js';
import type { TaskStatus } from '../../status.js';

const STATUS_TO_PHASE = {
  queued: 'working',
  working: 'working',
  needs_input: 'needs_input',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const satisfies Record<TaskStatus, ExecutiveUpdatePhase>;

function toolNames(events: readonly CodingEvent[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool_started' || event.type === 'tool_finished') {
      names.add(event.tool);
    }
  }
  return [...names];
}

/**
 * Reference {@link ExecutivePresenter} implementation. Deterministic
 * string templating stands in for the real OpenAI Agents SDK
 * summarization call (E1's job): a fake north star for the phase-mapping
 * and schema-shape contract, not for summary quality.
 */
export class FakeExecutivePresenter implements ExecutivePresenter {
  async summarizeProgress(input: SummarizeProgressInput): Promise<ExecutiveUpdate> {
    const tools = toolNames(input.events);
    return {
      taskId: input.taskId,
      turnId: input.turnId,
      phase: 'working',
      headline: tools.length > 0 ? `Working on it (${tools.join(', ')})` : 'Working on it',
      createdAt: new Date().toISOString(),
    };
  }

  async summarizeOutcome(input: SummarizeOutcomeInput): Promise<SummarizeOutcomeResult> {
    const now = new Date().toISOString();
    const tools = toolNames(input.events);
    const update: ExecutiveUpdate = {
      taskId: input.taskId,
      turnId: input.turnId,
      phase: STATUS_TO_PHASE[input.status],
      headline: `Outcome: ${input.status}`,
      createdAt: now,
    };
    return {
      update,
      technicalSummary: {
        taskId: input.taskId,
        turnId: input.turnId,
        narrative: `Ran ${input.events.length} normalized event(s); final status "${input.status}".`,
        toolsUsed: tools,
        filesTouched: [],
        createdAt: now,
      },
    };
  }
}
