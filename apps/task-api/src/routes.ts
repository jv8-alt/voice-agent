import { randomUUID } from 'node:crypto';

import websocket from '@fastify/websocket';
import {
  ApprovalResolveMessageSchema,
  ClientMessageSchema,
  CreateTaskRequestSchema,
  CreateTurnRequestSchema,
  CreateVoiceClientSecretRequestSchema,
  CreateVoiceClientSecretResponseSchema,
  GetTaskEventsQuerySchema,
  conflictError,
  invalidInputError,
  missingResourceError,
  type ActorContext,
  type CommandReceiptStore,
  type ReplayableServerMessage,
  type ServerMessage,
  type TaskEventLog,
  type TaskStore,
} from '@voice-agent/contracts';
import type { FastifyInstance } from 'fastify';

import type { TaskApiConfig } from './config.js';
import { toHttpProblem } from './errors.js';
import type { TaskOrchestrator } from './task-orchestrator.js';

export interface VoiceClientSecretProvider {
  create(): Promise<{ readonly clientSecret: string; readonly expiresAt: string }>;
}

export interface TaskRouteDependencies {
  readonly orchestrator: TaskOrchestrator;
  readonly taskStore: TaskStore;
  readonly eventLog: TaskEventLog;
  readonly commandReceipts: CommandReceiptStore;
  readonly voiceClientSecrets: VoiceClientSecretProvider;
}

const actor: ActorContext = { actorId: 'demo-user' };

export async function registerTaskRoutes(
  app: FastifyInstance,
  dependencies: TaskRouteDependencies,
  config: TaskApiConfig,
): Promise<void> {
  await app.register(websocket);

  app.get('/tasks', async () => ({ tasks: await dependencies.taskStore.listTasks(actor) }));

  app.post('/tasks', async (request, reply) => {
    const body = parse(CreateTaskRequestSchema, request.body);
    const started = await dependencies.orchestrator.createTask(actor, {
      workspaceId: config.demoRepoId,
      title: body.title,
      ...body.turn,
    });
    const snapshot = await dependencies.taskStore.getSnapshot(actor, started.task.id);
    if (!snapshot) throw missingResourceError(`No task with ID "${started.task.id}".`);
    void started.completion;
    return reply.code(201).send(snapshot);
  });

  app.get<{ Params: { taskId: string } }>('/tasks/:taskId', async (request) => {
    const snapshot = await dependencies.taskStore.getSnapshot(actor, request.params.taskId);
    if (!snapshot) throw missingResourceError(`No task with ID "${request.params.taskId}".`);
    return snapshot;
  });

  app.post<{ Params: { taskId: string } }>('/tasks/:taskId/turns', async (request, reply) => {
    const body = parse(CreateTurnRequestSchema, request.body);
    const started = await dependencies.orchestrator.createTurn(actor, request.params.taskId, body);
    void started.completion;
    return reply.code(201).send(started.turn);
  });

  app.get<{ Params: { taskId: string }; Querystring: { after?: string } }>(
    '/tasks/:taskId/events',
    async (request) => {
      await requireTask(dependencies.taskStore, request.params.taskId);
      const { after } = parse(GetTaskEventsQuerySchema, request.query);
      const result = await dependencies.eventLog.readSince(actor, request.params.taskId, after);
      return result.kind === 'replay'
        ? { kind: 'replay' as const, events: result.events.map(({ message }) => message) }
        : result;
    },
  );

  app.post('/voice/client-secret', async (request) => {
    parse(CreateVoiceClientSecretRequestSchema, request.body ?? {});
    return CreateVoiceClientSecretResponseSchema.parse(await dependencies.voiceClientSecrets.create());
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    let taskId: string | null = null;
    let cursor: string | null = null;
    let polling = false;
    socket.send(JSON.stringify({ type: 'connection.ready', connectionId: randomUUID() } satisfies ServerMessage));

    const send = (message: ServerMessage) => socket.send(JSON.stringify(message));
    const poll = async () => {
      if (polling || !taskId) return;
      polling = true;
      try {
        const result = await dependencies.eventLog.readSince(actor, taskId, cursor);
        if (result.kind === 'resync_required') {
          send({ type: 'resync_required', taskId });
          taskId = null;
          cursor = null;
          return;
        }
        for (const event of result.events) {
          send(event.message);
          cursor = event.id;
        }
      } catch (error) {
        sendError(send, error, request.id);
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), 15);
    socket.on('close', () => clearInterval(timer));

    let incoming = Promise.resolve();
    socket.on('message', (raw) => {
      incoming = incoming.then(async () => {
        try {
          const message = parse(ClientMessageSchema, JSON.parse(raw.toString()));
          if (message.type === 'task.subscribe') {
            const snapshot = await dependencies.taskStore.getSnapshot(actor, message.taskId);
            if (!snapshot) throw missingResourceError(`No task with ID "${message.taskId}".`);
            taskId = message.taskId;
            cursor = message.afterEventId;
            if (message.afterEventId === null) {
              send({
                type: 'task.snapshot',
                taskId,
                snapshot: snapshot.snapshot,
                lastEventId: snapshot.lastEventId,
              });
              cursor = snapshot.lastEventId;
            } else {
              await poll();
            }
            return;
          }

          const fingerprint = JSON.stringify(message);
          const prior = await dependencies.commandReceipts.get<ReplayableServerMessage>(actor, message.commandId);
          if (prior) {
            if (prior.payloadFingerprint !== fingerprint) {
              throw conflictError(`Command "${message.commandId}" was reused with a different payload.`);
            }
            send(prior.result);
            return;
          }

          const before = await dependencies.eventLog.latestEventId(actor, message.taskId);
          if (message.type === 'task.cancel') {
            await dependencies.orchestrator.cancel(actor, message.taskId, message.commandId);
          } else {
            const approval = parse(ApprovalResolveMessageSchema, message);
            void (await dependencies.orchestrator.resolveApproval(
              actor,
              approval.taskId,
              approval.approvalId,
              approval.decision,
              approval.commandId,
            )).completion;
          }
          const result = await commandResult(dependencies.eventLog, message.taskId, before, message.commandId);
          await dependencies.commandReceipts.save(actor, {
            commandId: message.commandId,
            payloadFingerprint: fingerprint,
            result,
            createdAt: new Date().toISOString(),
          });
          await poll();
        } catch (error) {
          const commandId = commandIdFrom(raw.toString());
          sendError(send, error, request.id, commandId);
        }
      });
    });
  });
}

async function commandResult(
  eventLog: TaskEventLog,
  taskId: string,
  before: string | null,
  commandId: string,
): Promise<ReplayableServerMessage> {
  const replay = await eventLog.readSince(actor, taskId, before);
  const result = replay.kind === 'replay'
    ? replay.events.map(({ message }) => message).find(
      (message) => 'commandId' in message && message.commandId === commandId,
    )
    : undefined;
  if (!result) throw conflictError(`Command "${commandId}" produced no result.`);
  return result;
}

async function requireTask(store: TaskStore, taskId: string): Promise<void> {
  if (!await store.getTask(actor, taskId)) throw missingResourceError(`No task with ID "${taskId}".`);
}

function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw invalidInputError('Request validation failed.');
  }
}

function sendError(
  send: (message: ServerMessage) => void,
  error: unknown,
  requestId: string,
  inReplyToCommandId?: string,
): void {
  send({
    type: 'error',
    error: toHttpProblem(error, requestId),
    ...(inReplyToCommandId ? { inReplyToCommandId } : {}),
  });
}

function commandIdFrom(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && 'commandId' in value && typeof value.commandId === 'string'
      ? value.commandId
      : undefined;
  } catch {
    return undefined;
  }
}
