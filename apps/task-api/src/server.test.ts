import { CreateTaskResponseSchema } from '@voice-agent/contracts';
import {
  FakeCodingAgent,
  FakeExecutivePresenter,
} from '@voice-agent/contracts/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { TaskApiConfig } from './config.js';
import { buildDemoTaskApi } from './server.js';

const config: TaskApiConfig = {
  openAiApiKey: 'test-key',
  port: 3001,
  webOrigin: 'http://localhost:3000',
  demoRepoId: 'demo-repo',
};
const apps: Awaited<ReturnType<typeof buildDemoTaskApi>>[] = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('demo composition', () => {
  it('runs the bundled fixture through real memory, workspace, routes, and orchestration boundaries', async () => {
    const app = await buildDemoTaskApi(config, {
      codingAgent: new FakeCodingAgent(),
      presenter: new FakeExecutivePresenter(),
      voiceClientSecrets: {
        async create() {
          return { clientSecret: 'test-secret', expiresAt: '2030-01-01T00:00:00.000Z' };
        },
      },
    });
    apps.push(app);

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'Fix the greeting',
        turn: { mode: 'ptt', text: 'Change the greeting and run its test' },
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = CreateTaskResponseSchema.parse(createdResponse.json());

    let loaded = created;
    for (let attempt = 0; attempt < 20 && loaded.snapshot.task.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      loaded = CreateTaskResponseSchema.parse((await app.inject({
        method: 'GET',
        url: `/tasks/${created.snapshot.task.id}`,
      })).json());
    }
    expect(loaded.snapshot.task.status).toBe('completed');
    expect(loaded.snapshot.task).not.toHaveProperty('workspaceId');
  });
});
