import type { CodingEvent } from '../domain.js';
import type { WorkspaceLease } from './workspace-provider.js';

interface CodingAgentInputBase {
  readonly taskId: string;
  readonly turnId: string;
  readonly workspace: WorkspaceLease;
  readonly signal: AbortSignal;
}

export interface PlanInput extends CodingAgentInputBase {
  readonly instructions: string;
}

export interface RunInput extends CodingAgentInputBase {
  readonly agentThreadId: string;
}

export interface ResumeInput extends CodingAgentInputBase {
  readonly agentThreadId: string;
  readonly instructions: string;
}

/**
 * Runs a coding task inside a leased, disposable workspace and emits a
 * normalized {@link CodingEvent} stream. Raw SDK/tool payloads never cross
 * this boundary. Every method must stop promptly and cleanly when `signal`
 * aborts.
 *
 * Demo adapter: `@openai/codex-sdk` against the leased fixture copy
 * (`packages/coding-agent-codex`), one resumable Codex thread per task.
 * Production adapter: the same or an alternative agent runtime behind an
 * identical event contract.
 */
export interface CodingAgent {
  /** Starts a new agent thread and plans read-only; never mutates the workspace. Emits `thread_ready` then `plan_ready`. */
  plan(input: PlanInput): AsyncIterable<CodingEvent>;

  /** Executes an already-planned, safe run against `agentThreadId` with workspace-write access. */
  run(input: RunInput): AsyncIterable<CodingEvent>;

  /** Continues `agentThreadId` with workspace-write access, either after approval or for a follow-up turn. */
  resume(input: ResumeInput): AsyncIterable<CodingEvent>;
}
