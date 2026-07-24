import { randomUUID } from 'node:crypto';
import { invalidInputError } from '../../errors.js';
import type { AcquireWorkspaceInput, WorkspaceLease, WorkspaceProvider } from '../../ports/workspace-provider.js';

const BASE_PATH = '/tmp/fake-workspaces';

function assertNoPathTraversal(field: 'taskId' | 'workspaceId', value: string): void {
  if (value.split(/[/\\]/).includes('..') || value.includes('\0')) {
    throw invalidInputError(`"${field}" must not contain a path-traversal segment.`, {
      details: { field, value },
    });
  }
}

/**
 * Reference {@link WorkspaceProvider} implementation. Does not touch the
 * real filesystem (leases are synthetic paths under an in-memory-tracked
 * base); C1's real fixture adapter additionally copies files and must
 * enforce containment for actual file operations, not just identifiers.
 */
export class InMemoryFakeWorkspaceProvider implements WorkspaceProvider {
  private readonly leases = new Set<string>();

  async acquire(input: AcquireWorkspaceInput): Promise<WorkspaceLease> {
    assertNoPathTraversal('taskId', input.taskId);
    assertNoPathTraversal('workspaceId', input.workspaceId);

    const leaseId = randomUUID();
    this.leases.add(leaseId);
    return { leaseId, rootPath: `${BASE_PATH}/${input.taskId}/${leaseId}` };
  }

  async release(leaseId: string): Promise<void> {
    this.leases.delete(leaseId);
  }
}
