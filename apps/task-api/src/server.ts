import { pathToFileURL } from 'node:url';

import { CodexCodingAgent } from '@voice-agent/coding-agent-codex';
import type { CodingAgent, ExecutivePresenter } from '@voice-agent/contracts';
import {
  HeuristicActionRiskEvaluator,
  OpenAIExecutivePresenter,
  OpenAIOutcomeSummaryModel,
} from '@voice-agent/executive-openai';
import { createMemoryTaskAdapters } from '@voice-agent/task-store-memory';
import { FixtureWorkspaceProvider } from '@voice-agent/workspace-fixture';

import { buildTaskApi } from './app.js';
import { parseTaskApiConfig, type TaskApiConfig } from './config.js';
import { registerTaskRoutes, type VoiceClientSecretProvider } from './routes.js';
import { TaskOrchestrator } from './task-orchestrator.js';

export interface DemoAdapterOverrides {
  readonly codingAgent?: CodingAgent;
  readonly presenter?: ExecutivePresenter;
  readonly voiceClientSecrets?: VoiceClientSecretProvider;
}

export async function buildDemoTaskApi(
  config: TaskApiConfig,
  overrides: DemoAdapterOverrides = {},
) {
  const memory = createMemoryTaskAdapters({ replayCapacity: 100 });
  const orchestrator = new TaskOrchestrator({
    ...memory,
    workspaceProvider: new FixtureWorkspaceProvider(),
    codingAgent: overrides.codingAgent ?? new CodexCodingAgent(),
    presenter: overrides.presenter ??
      new OpenAIExecutivePresenter(new OpenAIOutcomeSummaryModel()),
    riskEvaluator: new HeuristicActionRiskEvaluator(),
  });
  const dependencies = {
    ...memory,
    orchestrator,
    voiceClientSecrets: overrides.voiceClientSecrets ??
      new OpenAIVoiceClientSecretProvider(config.openAiApiKey),
  };
  return buildTaskApi({
    config,
    dependencies,
    logger: true,
    register(app, context) {
      return registerTaskRoutes(app, context.dependencies, context.config);
    },
  });
}

export class OpenAIVoiceClientSecretProvider implements VoiceClientSecretProvider {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async create() {
    const response = await this.request('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          audio: { output: { voice: 'marin' } },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI voice token request failed (${response.status})`);
    const body = await response.json() as { value?: unknown; expires_at?: unknown };
    if (typeof body.value !== 'string' || typeof body.expires_at !== 'number') {
      throw new Error('OpenAI voice token response was invalid');
    }
    return {
      clientSecret: body.value,
      expiresAt: new Date(body.expires_at * 1000).toISOString(),
    };
  }
}

async function main() {
  const config = parseTaskApiConfig(process.env);
  const app = await buildDemoTaskApi(config);
  await app.listen({ host: '127.0.0.1', port: config.port });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
