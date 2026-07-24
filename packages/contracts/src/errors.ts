import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Domain-level failure categories pinned by MIKADO.md's frozen trunk
 * contracts. HTTP status mapping (400/404/409/503/500) is the transport
 * responsibility, not part of this domain vocabulary.
 */
export const TaskErrorCodeSchema = z.enum([
  'invalid_input',
  'not_found',
  'conflict',
  'dependency_unavailable',
  'internal',
]);

export type TaskErrorCode = z.infer<typeof TaskErrorCodeSchema>;

export type JsonPrimitive = null | boolean | number | string;
export type JsonSafeValue =
  | JsonPrimitive
  | JsonPrimitive[]
  | { [key: string]: JsonPrimitive | JsonPrimitive[] };

const JsonPrimitiveSchema = z.union([z.null(), z.boolean(), z.number().finite(), z.string()]);
export const JsonSafeValueSchema: z.ZodType<JsonSafeValue> = z.union([
  JsonPrimitiveSchema,
  z.array(JsonPrimitiveSchema),
  z.record(z.union([JsonPrimitiveSchema, z.array(JsonPrimitiveSchema)])),
]);

/** The single typed error shape used at every boundary in the system. */
export const TaskErrorProblemSchema = z.object({
  code: TaskErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  requestId: z.string().min(1),
  details: JsonSafeValueSchema.optional(),
});

export type TaskErrorProblem = z.infer<typeof TaskErrorProblemSchema>;

export interface TaskErrorOptions {
  readonly requestId?: string;
  readonly retryable?: boolean;
  readonly details?: JsonSafeValue | undefined;
}

/**
 * Throwable domain error carrying the frozen `{ code, message, retryable,
 * requestId, details? }` problem shape. Use `toProblem()` to obtain the
 * plain, serializable shape for logging or (later, in T3) wire responses.
 */
export class TaskError extends Error implements TaskErrorProblem {
  readonly code: TaskErrorCode;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly details?: JsonSafeValue | undefined;

  constructor(problem: TaskErrorProblem) {
    super(problem.message);
    this.name = 'TaskError';
    this.code = problem.code;
    this.retryable = problem.retryable;
    this.requestId = problem.requestId;
    this.details = problem.details;
  }

  toProblem(): TaskErrorProblem {
    return TaskErrorProblemSchema.parse({
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      requestId: this.requestId,
      ...(this.details !== undefined ? { details: this.details } : {}),
    });
  }
}

function buildError(
  code: TaskErrorCode,
  message: string,
  defaultRetryable: boolean,
  options: TaskErrorOptions,
): TaskError {
  const requestId = options.requestId ?? randomUUID();
  const retryable = options.retryable ?? defaultRetryable;
  return new TaskError({
    code,
    message,
    retryable,
    requestId,
    ...(options.details !== undefined ? { details: options.details } : {}),
  });
}

/** Pinned category: malformed or semantically invalid caller input. */
export function invalidInputError(message: string, options: TaskErrorOptions = {}): TaskError {
  return buildError('invalid_input', message, false, options);
}

/** Pinned category: a referenced task, turn, or workspace does not exist. */
export function missingResourceError(message: string, options: TaskErrorOptions = {}): TaskError {
  return buildError('not_found', message, false, options);
}

/**
 * Pinned category: an active-turn conflict or an invalid status
 * transition was attempted (e.g. starting a turn while one is already
 * active, or `completed -> working`).
 */
export function conflictError(message: string, options: TaskErrorOptions = {}): TaskError {
  return buildError('conflict', message, false, options);
}

/** Pinned category: a required external dependency (Codex, OpenAI, workspace) is unavailable. */
export function dependencyUnavailableError(message: string, options: TaskErrorOptions = {}): TaskError {
  return buildError('dependency_unavailable', message, true, options);
}

/** Pinned category: an unexpected internal failure. */
export function internalError(message: string, options: TaskErrorOptions = {}): TaskError {
  return buildError('internal', message, false, options);
}
