import {
  TaskError,
  TaskErrorProblemSchema,
  mapTaskErrorCodeToHttpStatus,
  type TaskErrorProblem,
} from '@voice-agent/contracts';
import type { FastifyError, FastifyInstance } from 'fastify';

function isValidationError(error: FastifyError): boolean {
  return error.validation !== undefined;
}

export function toHttpProblem(error: unknown, requestId: string): TaskErrorProblem {
  if (error instanceof TaskError) {
    const problem = error.toProblem();
    return TaskErrorProblemSchema.parse({
      ...problem,
      requestId,
    });
  }

  if (isFastifyError(error) && isValidationError(error)) {
    return {
      code: 'invalid_input',
      message: 'Request validation failed',
      retryable: false,
      requestId,
    };
  }

  return {
    code: 'internal',
    message: 'Internal server error',
    retryable: false,
    requestId,
  };
}

function isFastifyError(error: unknown): error is FastifyError {
  return error instanceof Error && 'code' in error;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const problem = toHttpProblem(error, request.id);
    if (problem.code === 'internal') {
      request.log.error({ err: error }, 'request failed');
    }
    void reply.code(mapTaskErrorCodeToHttpStatus(problem.code)).send(problem);
  });
}
