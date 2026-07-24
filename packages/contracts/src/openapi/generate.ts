import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
  type ResponseConfig,
} from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { z } from 'zod';
import { TaskErrorProblemSchema } from '../errors.js';
import { TASK_ENDPOINT_ERROR_CODES, mapTaskErrorCodeToHttpStatus, type TaskEndpointKey } from '../http/error-mapping.js';
import {
  CreateTaskRequestSchema,
  CreateTaskResponseSchema,
  CreateTurnParamsSchema,
  CreateTurnRequestSchema,
  CreateTurnResponseSchema,
  GetTaskEventsParamsSchema,
  GetTaskEventsQuerySchema,
  GetTaskEventsResponseSchema,
  GetTaskParamsSchema,
  GetTaskResponseSchema,
  GetTasksResponseSchema,
} from '../http/tasks.js';
import { CreateVoiceClientSecretResponseSchema } from '../http/voice.js';

// Side effect: adds `.openapi(...)` to every ZodType, including schemas
// defined in sibling modules (domain.ts, errors.ts, ws/*) that this
// module transitively imports. Must run before any `registerPath` call.
extendZodWithOpenApi(z);

function errorResponses(endpoint: TaskEndpointKey): Record<number, ResponseConfig> {
  const responses: Record<number, ResponseConfig> = {};
  for (const code of TASK_ENDPOINT_ERROR_CODES[endpoint]) {
    responses[mapTaskErrorCodeToHttpStatus(code)] = {
      description: `Pinned "${code}" failure.`,
      content: { 'application/json': { schema: TaskErrorProblemSchema } },
    };
  }
  return responses;
}

function jsonResponse(description: string, schema: z.ZodTypeAny): ResponseConfig {
  return { description, content: { 'application/json': { schema } } };
}

function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();

  registry.registerPath({
    method: 'get',
    path: '/tasks',
    summary: 'List tasks for the current actor',
    tags: ['tasks'],
    responses: {
      200: jsonResponse('Tasks for the current actor.', GetTasksResponseSchema),
      ...errorResponses('GET /tasks'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/tasks',
    summary: "Create a task from its first turn's text",
    tags: ['tasks'],
    request: {
      body: { content: { 'application/json': { schema: CreateTaskRequestSchema } } },
    },
    responses: {
      201: jsonResponse('The newly created task, as a full snapshot.', CreateTaskResponseSchema),
      ...errorResponses('POST /tasks'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/tasks/{taskId}',
    summary: 'Load a task snapshot',
    tags: ['tasks'],
    request: { params: GetTaskParamsSchema },
    responses: {
      200: jsonResponse('The task, its turns, updates, and any pending approval.', GetTaskResponseSchema),
      ...errorResponses('GET /tasks/{taskId}'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/tasks/{taskId}/turns',
    summary: 'Submit a follow-up turn (typed fallback path)',
    tags: ['tasks'],
    request: {
      params: CreateTurnParamsSchema,
      body: { content: { 'application/json': { schema: CreateTurnRequestSchema } } },
    },
    responses: {
      201: jsonResponse('The newly created turn.', CreateTurnResponseSchema),
      ...errorResponses('POST /tasks/{taskId}/turns'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/tasks/{taskId}/events',
    summary: 'HTTP fallback for WebSocket replay',
    tags: ['tasks'],
    request: { params: GetTaskEventsParamsSchema, query: GetTaskEventsQuerySchema },
    responses: {
      200: jsonResponse('Either a replay slice or a resync signal.', GetTaskEventsResponseSchema),
      ...errorResponses('GET /tasks/{taskId}/events'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/ws',
    summary: 'WebSocket upgrade endpoint (no JSON body; see ClientMessage/ServerMessage)',
    tags: ['tasks'],
    responses: {
      101: { description: 'Switching Protocols to WebSocket.' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/voice/client-secret',
    summary: 'Mint a short-lived OpenAI Realtime client secret',
    tags: ['voice'],
    responses: {
      200: jsonResponse('A short-lived client secret for browser voice.', CreateVoiceClientSecretResponseSchema),
      ...errorResponses('POST /voice/client-secret'),
    },
  });

  return registry;
}

/**
 * Generates the OpenAPI 3.1 document describing every REST endpoint pinned
 * in MIKADO.md's "Frozen trunk contracts", including the pinned error
 * response for each status code an endpoint may return. Library choice
 * (T3): `@asteasolutions/zod-to-openapi`, pinned to `7.3.4` (its last
 * release supporting Zod v3, which the rest of the workspace uses) rather
 * than hand-rolling a Zod-to-JSON-Schema converter.
 */
export function generateOpenApiDocument(): OpenAPIObject {
  const registry = buildRegistry();
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Voice Coding Agent Task API',
      version: '0.1.0',
      description: 'REST surface for task creation, snapshots, typed turns, and WebSocket replay fallback.',
    },
    servers: [{ url: 'http://localhost:3001' }],
  }) as OpenAPIObject;
}
