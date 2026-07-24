/**
 * An opaque handle to a disposable, isolated copy of a fixture repository.
 * Deliberately minimal and technology-agnostic: it names a lease and a
 * root path, not a specific sandboxing mechanism.
 */
export interface WorkspaceLease {
  readonly leaseId: string;
  readonly rootPath: string;
}

export interface AcquireWorkspaceInput {
  readonly taskId: string;
  readonly fixtureId: string;
}

/**
 * Provisions and reclaims isolated, disposable workspaces copied from
 * immutable fixture sources. Implementations are responsible for path
 * containment: no operation against a lease may escape its root.
 *
 * Demo adapter: local filesystem copy under an ignored `.workspaces/`
 * directory (`packages/workspace-fixture`). Production adapter: a
 * sandboxed container or ephemeral VM checkout of a remote repository.
 */
export interface WorkspaceProvider {
  acquire(input: AcquireWorkspaceInput): Promise<WorkspaceLease>;
  release(leaseId: string): Promise<void>;
}
