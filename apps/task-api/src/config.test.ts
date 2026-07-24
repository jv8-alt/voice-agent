import { describe, expect, it } from 'vitest';

import { parseTaskApiConfig } from './config.js';

const VALID_ENV = {
  OPENAI_API_KEY: 'test-key',
  PORT: '3001',
  WEB_ORIGIN: 'http://localhost:3000',
  DEMO_REPO_ID: 'fixture-repo',
} as const;

describe('parseTaskApiConfig', () => {
  it('parses the frozen API environment', () => {
    expect(parseTaskApiConfig(VALID_ENV)).toEqual({
      openAiApiKey: 'test-key',
      port: 3001,
      webOrigin: 'http://localhost:3000',
      demoRepoId: 'fixture-repo',
    });
  });

  it.each(['OPENAI_API_KEY', 'PORT', 'WEB_ORIGIN', 'DEMO_REPO_ID'] as const)(
    'rejects a missing %s',
    (name) => {
      expect(() => parseTaskApiConfig({ ...VALID_ENV, [name]: undefined })).toThrow(name);
    },
  );

  it.each(['0', '65536', '1.5', 'abc'])('rejects invalid PORT %s', (port) => {
    expect(() => parseTaskApiConfig({ ...VALID_ENV, PORT: port })).toThrow('PORT');
  });

  it.each(['localhost:3000', 'ftp://example.com', 'https://example.com/path'])(
    'rejects invalid WEB_ORIGIN %s',
    (webOrigin) => {
      expect(() => parseTaskApiConfig({ ...VALID_ENV, WEB_ORIGIN: webOrigin })).toThrow(
        'WEB_ORIGIN',
      );
    },
  );
});
