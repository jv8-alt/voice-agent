import { isAbsolute, resolve } from 'node:path';
import {
  Codex,
  type ThreadEvent,
  type ThreadOptions,
  type TurnOptions,
} from '@openai/codex-sdk';
import {
  dependencyUnavailableError,
  internalError,
  invalidInputError,
  TaskError,
  type CodingAgent,
  type CodingEvent,
  type PlanInput,
  type ProposedAction,
  type ResumeInput,
  type RunInput,
} from '@voice-agent/contracts';

export interface CodexThread {
  runStreamed(
    input: string,
    options?: TurnOptions,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
}

export interface CodexClient {
  startThread(options?: ThreadOptions): CodexThread;
  resumeThread(id: string, options?: ThreadOptions): CodexThread;
}

export interface CodexCodingAgentOptions {
  readonly client?: CodexClient;
}

const planOutputSchema = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['read', 'write', 'exec', 'network', 'other'] },
          summary: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          command: { type: 'string' },
        },
        required: ['kind', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['actions'],
  additionalProperties: false,
} as const;

function threadOptions(rootPath: string, sandboxMode: 'read-only' | 'workspace-write'): ThreadOptions {
  if (!isAbsolute(rootPath) || resolve(rootPath) !== rootPath) {
    throw invalidInputError('Workspace rootPath must be an absolute normalized path');
  }
  return {
    workingDirectory: rootPath,
    sandboxMode,
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    approvalPolicy: 'never',
    skipGitRepoCheck: true,
  };
}

function parsePlan(text: string): ProposedAction[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw dependencyUnavailableError('Codex returned an invalid planning response');
  }
  if (typeof parsed !== 'object' || parsed === null || !('actions' in parsed) || !Array.isArray(parsed.actions)) {
    throw dependencyUnavailableError('Codex returned an invalid planning response');
  }

  return parsed.actions.map((value) => {
    if (typeof value !== 'object' || value === null) {
      throw dependencyUnavailableError('Codex returned an invalid planned action');
    }
    const action = value as Record<string, unknown>;
    const kinds = ['read', 'write', 'exec', 'network', 'other'] as const;
    if (!kinds.some((kind) => kind === action.kind) || typeof action.summary !== 'string' || action.summary.length === 0) {
      throw dependencyUnavailableError('Codex returned an invalid planned action');
    }
    if (action.paths !== undefined && (!Array.isArray(action.paths) || !action.paths.every((path) => typeof path === 'string'))) {
      throw dependencyUnavailableError('Codex returned invalid action paths');
    }
    if (action.command !== undefined && typeof action.command !== 'string') {
      throw dependencyUnavailableError('Codex returned an invalid action command');
    }
    return {
      kind: action.kind as ProposedAction['kind'],
      summary: action.summary,
      ...(action.paths !== undefined ? { paths: action.paths as string[] } : {}),
      ...(action.command !== undefined ? { command: action.command } : {}),
    };
  });
}

function itemTool(event: Extract<ThreadEvent, { type: 'item.started' | 'item.completed' }>): string | undefined {
  switch (event.item.type) {
    case 'command_execution':
      return 'command';
    case 'file_change':
      return 'file_change';
    case 'mcp_tool_call':
      return `${event.item.server}.${event.item.tool}`;
    case 'web_search':
      return 'web_search';
    default:
      return undefined;
  }
}

function itemSummary(event: Extract<ThreadEvent, { type: 'item.started' | 'item.completed' }>): string {
  switch (event.item.type) {
    case 'command_execution':
      return event.item.command;
    case 'file_change':
      return `${event.item.changes.length} file change(s)`;
    case 'mcp_tool_call':
      return event.item.error?.message ?? event.item.tool;
    case 'web_search':
      return event.item.query;
    default:
      return '';
  }
}

function itemOk(item: Extract<ThreadEvent, { type: 'item.completed' }>['item']): boolean {
  if ('status' in item && item.status === 'failed') {
    return false;
  }
  if ('exit_code' in item && typeof item.exit_code === 'number' && item.exit_code !== 0) {
    return false;
  }
  return true;
}

function dependencyFailure(message: string): CodingEvent {
  return {
    type: 'failed',
    error: dependencyUnavailableError(message).toProblem(),
  };
}

function normalizedFailure(error: unknown, fallback: string): CodingEvent {
  if (error instanceof TaskError) {
    return { type: 'failed', error: error.toProblem() };
  }
  return dependencyFailure(error instanceof Error ? error.message : fallback);
}

/**
 * Normalizes the Codex SDK stream while enforcing the read-only planning and
 * workspace-write execution split required by the CodingAgent port.
 */
export class CodexCodingAgent implements CodingAgent {
  readonly #client: CodexClient;

  constructor(options: CodexCodingAgentOptions = {}) {
    this.#client = options.client ?? new Codex();
  }

  async *plan(input: PlanInput): AsyncIterable<CodingEvent> {
    if (input.signal.aborted) {
      return;
    }
    let thread: CodexThread;
    try {
      thread = this.#client.startThread(threadOptions(input.workspace.rootPath, 'read-only'));
    } catch (error) {
      if (input.signal.aborted) return;
      yield normalizedFailure(error, 'Codex is unavailable');
      return;
    }

    const prompt = [
      'Inspect this repository and propose a plan only.',
      'Do not modify files, execute mutating commands, or use the network.',
      'Return structured actions describing every read, write, and command the implementation would need.',
      `User request: ${input.instructions}`,
    ].join('\n');
    yield* this.#stream(thread, prompt, input.signal, 'plan');
  }

  async *run(input: RunInput): AsyncIterable<CodingEvent> {
    if (input.signal.aborted) {
      return;
    }
    let thread: CodexThread;
    try {
      thread = this.#client.resumeThread(
        input.agentThreadId,
        threadOptions(input.workspace.rootPath, 'workspace-write'),
      );
    } catch (error) {
      if (input.signal.aborted) return;
      yield normalizedFailure(error, 'Codex is unavailable');
      return;
    }
    yield* this.#stream(
      thread,
      'Implement the approved plan now. Stay inside the workspace, do not use the network, and run the relevant tests.',
      input.signal,
      'execute',
    );
  }

  async *resume(input: ResumeInput): AsyncIterable<CodingEvent> {
    if (input.signal.aborted) {
      return;
    }
    let thread: CodexThread;
    try {
      thread = this.#client.resumeThread(
        input.agentThreadId,
        threadOptions(input.workspace.rootPath, 'workspace-write'),
      );
    } catch (error) {
      if (input.signal.aborted) return;
      yield normalizedFailure(error, 'Codex is unavailable');
      return;
    }
    yield* this.#stream(
      thread,
      `${input.instructions}\nStay inside the workspace, do not use the network, and run the relevant tests.`,
      input.signal,
      'execute',
    );
  }

  async *#stream(
    thread: CodexThread,
    prompt: string,
    signal: AbortSignal,
    mode: 'plan' | 'execute',
  ): AsyncIterable<CodingEvent> {
    let finalResponse = '';
    let sawFailedTool = false;
    try {
      const turn = await thread.runStreamed(
        prompt,
        mode === 'plan' ? { signal, outputSchema: planOutputSchema } : { signal },
      );
      for await (const event of turn.events) {
        if (signal.aborted) {
          return;
        }
        if (event.type === 'thread.started' && mode === 'plan') {
          yield { type: 'thread_ready', threadId: event.thread_id };
        } else if (event.type === 'item.started') {
          const tool = itemTool(event);
          if (tool !== undefined) {
            yield { type: 'tool_started', tool, summary: itemSummary(event) };
          }
        } else if (event.type === 'item.completed') {
          if (event.item.type === 'agent_message') {
            finalResponse = event.item.text;
            if (mode === 'execute') {
              yield { type: 'message', text: event.item.text };
            }
          } else {
            const tool = itemTool(event);
            if (tool !== undefined) {
              const ok = itemOk(event.item);
              if (!ok) {
                sawFailedTool = true;
              }
              yield { type: 'tool_finished', tool, summary: itemSummary(event), ok };
            }
          }
        } else if (event.type === 'turn.completed') {
          if (mode === 'plan') {
            yield { type: 'plan_ready', actions: parsePlan(finalResponse) };
          } else if (sawFailedTool) {
            yield {
              type: 'failed',
              error: internalError('Codex completed the turn with one or more failed tools.').toProblem(),
            };
            return;
          } else {
            yield { type: 'completed', summary: finalResponse || 'Codex completed the turn.' };
          }
        } else if (event.type === 'turn.failed' || event.type === 'error') {
          yield dependencyFailure(event.type === 'turn.failed' ? event.error.message : event.message);
          return;
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      yield normalizedFailure(error, 'Codex is unavailable');
    }
  }
}
