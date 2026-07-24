import { describe, expect, it } from 'vitest';
import {
  TaskError,
  TaskErrorProblemSchema,
  conflictError,
  dependencyUnavailableError,
  internalError,
  invalidInputError,
  missingResourceError,
  unsupportedFixtureError,
} from './errors.js';

describe('pinned error constructors', () => {
  it.each([
    [invalidInputError, 'invalid_input', false],
    [missingResourceError, 'not_found', false],
    [conflictError, 'conflict', false],
    [unsupportedFixtureError, 'unsupported_fixture', false],
    [dependencyUnavailableError, 'dependency_unavailable', true],
    [internalError, 'internal', false],
  ] as const)('%# produces code %s with default retryable %s', (factory, code, retryable) => {
    const error = factory('something went wrong', { requestId: 'req-42' });

    expect(error).toBeInstanceOf(TaskError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.message).toBe('something went wrong');
    expect(error.retryable).toBe(retryable);
    expect(error.requestId).toBe('req-42');

    const problem = error.toProblem();
    expect(TaskErrorProblemSchema.safeParse(problem).success).toBe(true);
    expect(problem).toEqual({
      code,
      message: 'something went wrong',
      retryable,
      requestId: 'req-42',
    });
  });

  it('allows overriding the default retryable flag', () => {
    const error = internalError('boom', { retryable: true, requestId: 'req-1' });
    expect(error.retryable).toBe(true);
  });

  it('carries structured details when provided', () => {
    const error = conflictError('turn already active', {
      requestId: 'req-1',
      details: { taskId: 'task-1' },
    });
    expect(error.details).toEqual({ taskId: 'task-1' });
    expect(error.toProblem().details).toEqual({ taskId: 'task-1' });
  });

  it('generates a requestId when none is supplied', () => {
    const error = invalidInputError('bad input');
    expect(error.requestId.length).toBeGreaterThan(0);
  });
});

describe('TaskErrorProblemSchema', () => {
  it('rejects a problem missing required fields', () => {
    const result = TaskErrorProblemSchema.safeParse({ code: 'internal', message: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown error code', () => {
    const result = TaskErrorProblemSchema.safeParse({
      code: 'teapot',
      message: 'x',
      retryable: false,
      requestId: 'r1',
    });
    expect(result.success).toBe(false);
  });
});
