import {
  conflictError,
  dependencyUnavailableError,
  internalError,
  invalidInputError,
  missingResourceError,
  TaskErrorProblemSchema,
  type TaskError,
} from '@voice-agent/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTaskApi } from './app.js';
import type { TaskApiConfig } from './config.js';

const CONFIG: TaskApiConfig = {
  openAiApiKey: 'test-key',
  port: 3001,
  webOrigin: 'http://localhost:3000',
  demoRepoId: 'fixture-repo',
};

const apps: Awaited<ReturnType<typeof buildTaskApi>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('buildTaskApi', () => {
  it('provides health, CORS, and typed dependency injection seams', async () => {
    const dependencies = { marker: 'injected' };
    const app = await buildTaskApi({
      config: CONFIG,
      dependencies,
      register(instance, context) {
        instance.get('/injected', async () => ({
          marker: context.dependencies.marker,
          repoId: context.config.demoRepoId,
        }));
      },
    });
    apps.push(app);

    const health = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: CONFIG.webOrigin },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(health.headers['access-control-allow-origin']).toBe(CONFIG.webOrigin);

    const injected = await app.inject({ method: 'GET', url: '/injected' });
    expect(injected.json()).toEqual({ marker: 'injected', repoId: 'fixture-repo' });
  });

  it.each([
    ['invalid_input', 400, invalidInputError('invalid request')],
    ['not_found', 404, missingResourceError('missing task')],
    ['conflict', 409, conflictError('active turn')],
    ['dependency_unavailable', 503, dependencyUnavailableError('agent unavailable')],
    ['internal', 500, internalError('internal failure')],
  ] as const)('maps %s to HTTP %i with the frozen problem shape', async (code, status, error) => {
    const app = await errorApp(error);

    const response = await app.inject({ method: 'GET', url: '/fail' });
    const problem = TaskErrorProblemSchema.parse(response.json());

    expect(response.statusCode).toBe(status);
    expect(problem.code).toBe(code);
    expect(problem.requestId).toBeTruthy();
  });

  it('converts Fastify validation failures to invalid_input', async () => {
    const app = await buildTaskApi({
      config: CONFIG,
      dependencies: {},
      register(instance) {
        instance.get(
          '/validated',
          {
            schema: {
              querystring: {
                type: 'object',
                required: ['after'],
                properties: { after: { type: 'string' } },
              },
            },
          },
          async () => ({ ok: true }),
        );
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/validated' });
    expect(response.statusCode).toBe(400);
    expect(TaskErrorProblemSchema.parse(response.json()).code).toBe('invalid_input');
  });

  it('does not expose unexpected error details', async () => {
    const app = await buildTaskApi({
      config: CONFIG,
      dependencies: {},
      register(instance) {
        instance.get('/fail', async () => {
          throw new Error('secret internal cause');
        });
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/fail' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret internal cause');
    expect(response.json()).toMatchObject({
      code: 'internal',
      message: 'Internal server error',
      retryable: false,
    });
  });
});

async function errorApp(error: TaskError) {
  const app = await buildTaskApi({
    config: CONFIG,
    dependencies: {},
    register(instance) {
      instance.get('/fail', async () => {
        throw error;
      });
    },
  });
  apps.push(app);
  return app;
}
