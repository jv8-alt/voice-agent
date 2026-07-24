import { describe, expect, it } from 'vitest';
import { TaskErrorCodeSchema } from '../errors.js';
import { TASK_ENDPOINT_ERROR_CODES, mapTaskErrorCodeToHttpStatus } from './error-mapping.js';

describe('mapTaskErrorCodeToHttpStatus', () => {
  it.each([
    ['invalid_input', 400],
    ['not_found', 404],
    ['conflict', 409],
    ['unsupported_fixture', 422],
    ['dependency_unavailable', 503],
    ['internal', 500],
  ] as const)('maps %s to %i', (code, status) => {
    expect(mapTaskErrorCodeToHttpStatus(code)).toBe(status);
  });

  it('pins a status for every TaskErrorCode', () => {
    for (const code of TaskErrorCodeSchema.options) {
      expect(typeof mapTaskErrorCodeToHttpStatus(code)).toBe('number');
    }
  });
});

describe('TASK_ENDPOINT_ERROR_CODES', () => {
  it('lists only valid TaskErrorCode values for every endpoint', () => {
    for (const codes of Object.values(TASK_ENDPOINT_ERROR_CODES)) {
      for (const code of codes) {
        expect(TaskErrorCodeSchema.safeParse(code).success).toBe(true);
      }
    }
  });

  it('always allows internal for every endpoint', () => {
    for (const codes of Object.values(TASK_ENDPOINT_ERROR_CODES)) {
      expect(codes).toContain('internal');
    }
  });
});
