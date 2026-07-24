import { describe, expect, it } from 'vitest';
import { TaskError } from './errors.js';
import { canTransitionTurnStatus, isActiveTurnStatus, transitionTurnStatus } from './status.js';

describe('canTransitionTurnStatus', () => {
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
    expect(canTransitionTurnStatus(from, to)).toBe(true);
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
    expect(canTransitionTurnStatus(from, to)).toBe(false);
  });
});

describe('transitionTurnStatus', () => {
  it('returns the destination status for a legal transition', () => {
    expect(transitionTurnStatus('queued', 'working')).toBe('working');
  });

  it('throws a typed TaskError with code "conflict" for an illegal transition', () => {
    let caught: unknown;
    try {
      transitionTurnStatus('completed', 'working', { requestId: 'req-1' });
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
      expect(() => transitionTurnStatus('cancelled', to)).toThrow(TaskError);
    }
  });

  it('generates a requestId when none is supplied', () => {
    let caught: unknown;
    try {
      transitionTurnStatus('failed', 'working');
    } catch (error) {
      caught = error;
    }
    expect((caught as TaskError).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('isActiveTurnStatus', () => {
  it('treats queued, working, and needs_input as active', () => {
    expect(isActiveTurnStatus('queued')).toBe(true);
    expect(isActiveTurnStatus('working')).toBe(true);
    expect(isActiveTurnStatus('needs_input')).toBe(true);
  });

  it('treats completed, failed, and cancelled as inactive', () => {
    expect(isActiveTurnStatus('completed')).toBe(false);
    expect(isActiveTurnStatus('failed')).toBe(false);
    expect(isActiveTurnStatus('cancelled')).toBe(false);
  });
});
