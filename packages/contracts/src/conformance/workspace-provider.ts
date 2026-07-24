import { beforeEach, describe, expect, it } from 'vitest';
import { TaskError } from '../errors.js';
import type { WorkspaceProvider } from '../ports/workspace-provider.js';

/**
 * Conformance suite for {@link WorkspaceProvider}. `acquire()`/`release()`
 * are the port's only operations, so path-escape containment (pinned in
 * MIKADO.md's "Contract tests cover...") is tested at the one surface the
 * port exposes: a conformant provider must reject an identifier that
 * contains a path-traversal segment rather than silently resolving a
 * lease root outside its intended base directory. Real filesystem-level
 * escape (e.g. a symlink inside a lease pointing outside it) is
 * necessarily adapter-specific and is C1's job to test against the
 * concrete filesystem adapter.
 */
export function runWorkspaceProviderConformance(
  createProvider: () => WorkspaceProvider | Promise<WorkspaceProvider>,
): void {
  describe('WorkspaceProvider conformance', () => {
    let provider: WorkspaceProvider;

    beforeEach(async () => {
      provider = await createProvider();
    });

    it('acquires a lease with a non-empty leaseId and rootPath', async () => {
      const lease = await provider.acquire({ taskId: 'task-1', fixtureId: 'checkout-regression' });
      expect(lease.leaseId.length).toBeGreaterThan(0);
      expect(lease.rootPath.length).toBeGreaterThan(0);
    });

    it('gives distinct tasks distinct, non-overlapping leases', async () => {
      const first = await provider.acquire({ taskId: 'task-1', fixtureId: 'checkout-regression' });
      const second = await provider.acquire({ taskId: 'task-2', fixtureId: 'checkout-regression' });

      expect(first.leaseId).not.toBe(second.leaseId);
      expect(first.rootPath).not.toBe(second.rootPath);
    });

    it('release() does not throw for a lease it just acquired', async () => {
      const lease = await provider.acquire({ taskId: 'task-1', fixtureId: 'checkout-regression' });
      await expect(provider.release(lease.leaseId)).resolves.toBeUndefined();
    });

    it('release() is safe to call twice for the same lease (idempotent reclaim)', async () => {
      const lease = await provider.acquire({ taskId: 'task-1', fixtureId: 'checkout-regression' });
      await provider.release(lease.leaseId);
      await expect(provider.release(lease.leaseId)).resolves.toBeUndefined();
    });

    it('rejects a fixtureId containing a path-traversal segment', async () => {
      let caught: unknown;
      try {
        await provider.acquire({ taskId: 'task-1', fixtureId: '../../etc' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TaskError);
      expect((caught as TaskError).code).toBe('invalid_input');
    });

    it('rejects a taskId containing a path-traversal segment', async () => {
      let caught: unknown;
      try {
        await provider.acquire({ taskId: '../escape', fixtureId: 'checkout-regression' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TaskError);
      expect((caught as TaskError).code).toBe('invalid_input');
    });

    it('never returns a rootPath containing a ".." segment', async () => {
      const lease = await provider.acquire({ taskId: 'task-1', fixtureId: 'checkout-regression' });
      expect(lease.rootPath.split(/[/\\]/)).not.toContain('..');
    });
  });
}
