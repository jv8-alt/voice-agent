import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  CreateTaskResponseSchema,
  type CodingAgent,
  type CodingEvent,
  type PlanInput,
  type ResumeInput,
  type RunInput,
} from '@voice-agent/contracts';
import { FakeExecutivePresenter } from '@voice-agent/contracts/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { TaskApiConfig } from './config.js';
import { buildDemoTaskApi } from './server.js';

const execute = promisify(execFile);
const sourceGreeting = fileURLToPath(
  new URL('../../../fixtures/demo-repo/src/greeting.js', import.meta.url),
);
const sourceTest = fileURLToPath(
  new URL('../../../fixtures/demo-repo/test/greeting.test.js', import.meta.url),
);
const config: TaskApiConfig = {
  openAiApiKey: 'test-key',
  port: 3001,
  webOrigin: 'http://localhost:3000',
  demoRepoId: 'demo-repo',
};
const apps: Awaited<ReturnType<typeof buildDemoTaskApi>>[] = [];

class FixtureEditingAgent implements CodingAgent {
  ranFixtureTests = false;

  async *plan(input: PlanInput): AsyncIterable<CodingEvent> {
    yield { type: 'thread_ready', threadId: 'fixture-thread' };
    yield {
      type: 'plan_ready',
      actions: [
        { kind: 'write', summary: 'Update greeting and expectation', paths: ['src/greeting.js', 'test/greeting.test.js'] },
        { kind: 'exec', summary: 'Run fixture tests', command: 'node --test' },
      ],
    };
    expect(input.workspace.rootPath).not.toBe(fileURLToPath(new URL('../../../fixtures/demo-repo', import.meta.url)));
  }

  async *run(input: RunInput): AsyncIterable<CodingEvent> {
    await writeFile(
      `${input.workspace.rootPath}/src/greeting.js`,
      'export function greeting(name) { return `Welcome, ${name}!`; }\n',
    );
    await writeFile(
      `${input.workspace.rootPath}/test/greeting.test.js`,
      "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { greeting } from '../src/greeting.js';\ntest('greets', () => assert.equal(greeting('Ada'), 'Welcome, Ada!'));\n",
    );
    await execute(process.execPath, ['--test'], { cwd: input.workspace.rootPath });
    this.ranFixtureTests = true;
    yield { type: 'tool_finished', tool: 'node', summary: 'Fixture tests passed', ok: true };
    yield { type: 'completed', summary: 'Updated the greeting and verified it.' };
  }

  async *resume(_input: ResumeInput): AsyncIterable<CodingEvent> {
    yield { type: 'completed', summary: 'Follow-up complete.' };
  }
}

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('fixture golden path', () => {
  it('edits and tests a disposable demo-repo copy without changing its source', async () => {
    const originalGreeting = await readFile(sourceGreeting, 'utf8');
    const originalTest = await readFile(sourceTest, 'utf8');
    const codingAgent = new FixtureEditingAgent();
    const app = await buildDemoTaskApi(config, {
      codingAgent,
      presenter: new FakeExecutivePresenter(),
      voiceClientSecrets: {
        async create() {
          return { clientSecret: 'test-secret', expiresAt: '2030-01-01T00:00:00.000Z' };
        },
      },
    });
    apps.push(app);

    const created = CreateTaskResponseSchema.parse((await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'Change the greeting',
        turn: { mode: 'typing', text: 'Say Welcome and update the test' },
      },
    })).json());
    let snapshot = created;
    for (let attempt = 0; attempt < 40 && snapshot.snapshot.task.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      snapshot = CreateTaskResponseSchema.parse((await app.inject({
        method: 'GET',
        url: `/tasks/${created.snapshot.task.id}`,
      })).json());
    }

    expect(snapshot.snapshot.task.status).toBe('completed');
    expect(codingAgent.ranFixtureTests).toBe(true);
    expect(await readFile(sourceGreeting, 'utf8')).toBe(originalGreeting);
    expect(await readFile(sourceTest, 'utf8')).toBe(originalTest);
  });
});
