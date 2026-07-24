import { describe, expect, it } from 'vitest';
import { TaskError } from './errors.js';
import { canTransitionTaskStatus, isActiveTaskStatus, transitionTaskStatus } from './status.js';

describe('canTransitionTaskStatus', () => {
  it.each([
    ['queued', 'working'],
    ['working', 'needs_input'],
    ['needs_input', 'working'],
    ['working', 'completed'],
    ['working', 'failed'],
    ['queued', 'cancelled'],
    ['working', 'cancelled'],
    ['needs_input', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(true);
  });

  it.each([
    ['completed', 'working'],
    ['failed', 'working'],
    ['cancelled', 'working'],
    ['cancelled', 'completed'],
    ['completed', 'cancelled'],
    ['queued', 'completed'],
    ['queued', 'needs_input'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionTaskStatus(from, to)).toBe(false);
  });
});

describe('transitionTaskStatus', () => {
  it('returns the destination status for a legal transition', () => {
    expect(transitionTaskStatus('queued', 'working')).toBe('working');
  });

  it('throws a typed TaskError with code "conflict" for an illegal transition', () => {
    let caught: unknown;
    try {
      transitionTaskStatus('completed', 'working', { requestId: 'req-1' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TaskError);
    const error = caught as TaskError;
    expect(error.code).toBe('conflict');
    expect(error.retryable).toBe(false);
    expect(error.requestId).toBe('req-1');
    expect(error.details).toEqual({ from: 'completed', to: 'working' });
    expect(error.toProblem()).toEqual({
      code: 'conflict',
      message: error.message,
      retryable: false,
      requestId: 'req-1',
      details: { from: 'completed', to: 'working' },
    });
  });

  it('rejects cancelled -> anything', () => {
    for (const to of ['queued', 'working', 'needs_input', 'completed', 'failed', 'cancelled'] as const) {
      expect(() => transitionTaskStatus('cancelled', to)).toThrow(TaskError);
    }
  });

  it('generates a requestId when none is supplied', () => {
    let caught: unknown;
    try {
      transitionTaskStatus('failed', 'working');
    } catch (error) {
      caught = error;
    }
    expect((caught as TaskError).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('isActiveTaskStatus', () => {
  it('treats queued, working, and needs_input as active', () => {
    expect(isActiveTaskStatus('queued')).toBe(true);
    expect(isActiveTaskStatus('working')).toBe(true);
    expect(isActiveTaskStatus('needs_input')).toBe(true);
  });

  it('treats completed, failed, and cancelled as inactive', () => {
    expect(isActiveTaskStatus('completed')).toBe(false);
    expect(isActiveTaskStatus('failed')).toBe(false);
    expect(isActiveTaskStatus('cancelled')).toBe(false);
  });
});
