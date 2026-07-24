/**
 * A handle to a disposable, isolated workspace. The lease identity is opaque;
 * `rootPath` is the explicit local-demo seam required by the Codex adapter.
 */
export interface WorkspaceLease {
  readonly leaseId: string;
  readonly rootPath: string;
}

export interface AcquireWorkspaceInput {
  readonly taskId: string;
  readonly workspaceId: string;
}

/**
 * Provisions and reclaims isolated, disposable workspaces. Implementations
 * resolve the opaque workspace ID and are responsible for path
 * containment: no operation against a lease may escape its root.
 *
 * `rootPath` is an intentional demo adapter seam required by the local coding
 * agent. A production adapter can map the same lease to a sandbox/container.
 */
export interface WorkspaceProvider {
  acquire(input: AcquireWorkspaceInput): Promise<WorkspaceLease>;
  release(leaseId: string): Promise<void>;
}
