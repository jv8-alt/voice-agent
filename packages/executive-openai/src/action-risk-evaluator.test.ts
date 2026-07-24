import type { ProposedAction } from '@voice-agent/contracts';
import { runActionRiskEvaluatorConformance } from '@voice-agent/contracts/conformance';
import { describe, expect, it } from 'vitest';
import { HeuristicActionRiskEvaluator } from './action-risk-evaluator.js';

runActionRiskEvaluatorConformance(() => new HeuristicActionRiskEvaluator());

describe('HeuristicActionRiskEvaluator', () => {
  const evaluator = new HeuristicActionRiskEvaluator();

  it.each([
    ['hard reset', { kind: 'exec', summary: 'Reset', command: 'git reset --hard HEAD~1' }],
    ['recursive delete', { kind: 'exec', summary: 'Clean', command: 'rm -rf ./src' }],
    ['force push', { kind: 'exec', summary: 'Publish', command: 'git push origin main --force' }],
    ['credential access', { kind: 'read', summary: 'Inspect config', paths: ['/home/user/.ssh/id_ed25519'] }],
    ['system change', { kind: 'write', summary: 'Edit hosts', paths: ['/etc/hosts'] }],
    ['traversal system path', { kind: 'read', summary: 'Escape', paths: ['../../etc/passwd'] }],
    ['credential command', { kind: 'exec', summary: 'Read key', command: 'cat ~/.ssh/id_ed25519' }],
    ['environment command', { kind: 'exec', summary: 'Read environment', command: 'cat .env.production' }],
    ['system-path command', { kind: 'exec', summary: 'Read hosts', command: 'cat /etc/hosts' }],
    ['traversal system command', { kind: 'exec', summary: 'Read via traversal', command: 'cat ../../etc/hosts' }],
    ['dependency change', { kind: 'exec', summary: 'Install package', command: 'pnpm add left-pad' }],
    ['single-path multi-delete', { kind: 'exec', summary: 'Delete outputs', command: 'rm one.log two.log', paths: ['one.log'] }],
    ['network access', { kind: 'network', summary: 'Call a service' }],
    ['exec curl', { kind: 'exec', summary: 'Fetch URL', command: 'curl https://example.com' }],
    ['exec wget', { kind: 'exec', summary: 'Download file', command: 'wget https://example.com/file' }],
  ] satisfies [string, ProposedAction][])('marks %s as sensitive', async (_name, action) => {
    const result = await evaluator.evaluate({ taskId: 'task-1', turnId: 'turn-1', actions: [action] });
    expect(result.level).toBe('sensitive');
    expect(result.reasons[0]).not.toContain(action.summary);
  });

  it('allows bounded workspace edits and non-destructive checks', async () => {
    const result = await evaluator.evaluate({
      taskId: 'task-1',
      turnId: 'turn-1',
      actions: [
        { kind: 'write', summary: 'Update parser', paths: ['src/parser.ts'] },
        { kind: 'exec', summary: 'Run tests', command: 'pnpm test' },
      ],
    });
    expect(result).toEqual({ level: 'safe', reasons: [] });
  });
});
