import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from './generate.js';

describe('generateOpenApiDocument', () => {
  const document = generateOpenApiDocument();

  it('produces a structurally valid OpenAPI 3.1 document envelope', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
    expect(document.paths).toBeDefined();
  });

  it('describes exactly the pinned REST paths', () => {
    expect(Object.keys(document.paths ?? {}).sort()).toEqual(
      ['/tasks', '/tasks/{taskId}', '/tasks/{taskId}/events', '/tasks/{taskId}/turns', '/voice/client-secret', '/ws'].sort(),
    );
  });

  it('pins the expected HTTP method for each path', () => {
    const paths = document.paths ?? {};
    expect(paths['/tasks']).toHaveProperty('get');
    expect(paths['/tasks']).toHaveProperty('post');
    expect(paths['/tasks/{taskId}']).toHaveProperty('get');
    expect(paths['/tasks/{taskId}/turns']).toHaveProperty('post');
    expect(paths['/tasks/{taskId}/events']).toHaveProperty('get');
    expect(paths['/ws']).toHaveProperty('get');
    expect(paths['/voice/client-secret']).toHaveProperty('post');
  });

  it('attaches the pinned error status responses to each REST operation', () => {
    const paths = document.paths ?? {};
    const createTask = paths['/tasks']?.post;
    expect(createTask?.responses).toMatchObject({
      201: expect.anything(),
      400: expect.anything(),
      422: expect.anything(),
      500: expect.anything(),
    });

    const getTask = paths['/tasks/{taskId}']?.get;
    expect(getTask?.responses).toMatchObject({
      200: expect.anything(),
      404: expect.anything(),
      500: expect.anything(),
    });
  });

  it('is JSON-serializable', () => {
    expect(() => JSON.stringify(document)).not.toThrow();
  });
});
