import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { runWorkspaceProviderConformance } from '@voice-agent/contracts/conformance';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureWorkspaceProvider } from './fixture-workspace-provider.js';

let sandbox = '';
let fixtureRoot = '';
let leaseRoot = '';

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'workspace-fixture-test-'));
  fixtureRoot = join(sandbox, 'fixtures');
  leaseRoot = join(sandbox, 'leases');
  const source = join(fixtureRoot, 'demo-repo');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'counter.txt'), '0\n');
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

runWorkspaceProviderConformance(
  () => new FixtureWorkspaceProvider({ fixtureRoot, leaseRoot }),
);

describe('FixtureWorkspaceProvider', () => {
  it('keeps the fixture source immutable when a lease is edited', async () => {
    const provider = new FixtureWorkspaceProvider({ fixtureRoot, leaseRoot });
    const lease = await provider.acquire({ taskId: 'immutable', workspaceId: 'demo-repo' });

    await writeFile(join(lease.rootPath, 'counter.txt'), '1\n');

    await expect(readFile(join(fixtureRoot, 'demo-repo', 'counter.txt'), 'utf8')).resolves.toBe('0\n');
    await provider.release(lease.leaseId);
  });

  it('isolates writes made by different tasks', async () => {
    const provider = new FixtureWorkspaceProvider({ fixtureRoot, leaseRoot });
    const first = await provider.acquire({ taskId: 'first', workspaceId: 'demo-repo' });
    const second = await provider.acquire({ taskId: 'second', workspaceId: 'demo-repo' });

    await writeFile(join(first.rootPath, 'counter.txt'), '9\n');

    await expect(readFile(join(second.rootPath, 'counter.txt'), 'utf8')).resolves.toBe('0\n');
    await provider.release(first.leaseId);
    await provider.release(second.leaseId);
  });

  it('contains every lease beneath the configured lease root and removes it on release', async () => {
    const provider = new FixtureWorkspaceProvider({ fixtureRoot, leaseRoot });
    const lease = await provider.acquire({ taskId: 'contained', workspaceId: 'demo-repo' });
    expect(relative(await realpath(leaseRoot), lease.rootPath)).not.toMatch(/^\.\.(?:[/\\]|$)/);

    await provider.release(lease.leaseId);
    await expect(readFile(join(lease.rootPath, 'counter.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects fixture symlinks that could escape a lease', async () => {
    const outside = join(sandbox, 'outside.txt');
    const linkedFixture = join(fixtureRoot, 'linked-repo');
    await writeFile(outside, 'secret\n');
    await mkdir(linkedFixture);
    await symlink(outside, join(linkedFixture, 'escape'));
    const provider = new FixtureWorkspaceProvider({ fixtureRoot, leaseRoot });

    await expect(provider.acquire({ taskId: 'symlink', workspaceId: 'linked-repo' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
