import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { TaskApiConfig } from './config.js';
import { registerErrorHandler } from './errors.js';

export interface TaskApiRegistrationContext<TDependencies> {
  readonly config: TaskApiConfig;
  readonly dependencies: TDependencies;
}

export interface BuildTaskApiOptions<TDependencies> {
  readonly config: TaskApiConfig;
  readonly dependencies: TDependencies;
  readonly register?: (
    app: FastifyInstance,
    context: TaskApiRegistrationContext<TDependencies>,
  ) => void | Promise<void>;
  readonly logger?: FastifyServerOptions['logger'];
}

export async function buildTaskApi<TDependencies>(
  options: BuildTaskApiOptions<TDependencies>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  registerErrorHandler(app);
  await app.register(cors, {
    origin: options.config.webOrigin,
  });

  app.get('/health', async () => ({ status: 'ok' as const }));

  if (options.register) {
    await options.register(app, {
      config: options.config,
      dependencies: options.dependencies,
    });
  }

  await app.ready();
  return app;
}
