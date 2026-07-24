import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dependencyUnavailableError,
  invalidInputError,
  missingResourceError,
  TaskError,
  type AcquireWorkspaceInput,
  type WorkspaceLease,
  type WorkspaceProvider,
} from '@voice-agent/contracts';

const defaultFixtureRoot = fileURLToPath(new URL('../../../fixtures', import.meta.url));
const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface FixtureWorkspaceProviderOptions {
  readonly fixtureRoot?: string;
  readonly leaseRoot?: string;
}

function assertSafeId(name: 'taskId' | 'workspaceId', value: string): void {
  if (!safeId.test(value) || value === '.' || value === '..') {
    throw invalidInputError(`${name} must be a non-empty path-safe identifier`);
  }
}

function isContained(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

async function rejectSymlinks(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw invalidInputError(`Fixture repositories cannot contain symbolic links: ${entry.name}`);
    }
    if (stats.isDirectory()) {
      await rejectSymlinks(entryPath);
    }
  }
}

/**
 * Resolves an opaque demo workspace ID to a bundled fixture and copies it into
 * a task-specific temporary directory. Sources are never returned directly.
 */
export class FixtureWorkspaceProvider implements WorkspaceProvider {
  readonly #fixtureRoot: string;
  readonly #leaseRoot: string;
  readonly #leases = new Map<string, string>();

  constructor(options: FixtureWorkspaceProviderOptions = {}) {
    this.#fixtureRoot = resolve(options.fixtureRoot ?? defaultFixtureRoot);
    this.#leaseRoot = resolve(options.leaseRoot ?? join(tmpdir(), 'voice-agent-workspaces'));
  }

  async acquire(input: AcquireWorkspaceInput): Promise<WorkspaceLease> {
    assertSafeId('taskId', input.taskId);
    assertSafeId('workspaceId', input.workspaceId);

    try {
      const fixtureRoot = await realpath(this.#fixtureRoot);
      const sourceCandidate = resolve(fixtureRoot, input.workspaceId);
      if (!isContained(fixtureRoot, sourceCandidate)) {
        throw invalidInputError('workspaceId resolves outside the fixture root');
      }

      let source: string;
      try {
        source = await realpath(sourceCandidate);
      } catch {
        throw missingResourceError(`Workspace ${input.workspaceId} was not found`);
      }
      if (!isContained(fixtureRoot, source)) {
        throw invalidInputError('Workspace source resolves outside the fixture root');
      }
      if (!(await lstat(source)).isDirectory()) {
        throw invalidInputError('Workspace source must be a directory');
      }
      await rejectSymlinks(source);

      await mkdir(this.#leaseRoot, { recursive: true });
      const leaseRoot = await realpath(this.#leaseRoot);
      const container = await mkdtemp(join(leaseRoot, `${input.taskId}-`));
      const rootPath = join(container, 'workspace');
      if (!isContained(leaseRoot, rootPath)) {
        await rm(container, { recursive: true, force: true });
        throw invalidInputError('Lease resolves outside the configured lease root');
      }

      try {
        await cp(source, rootPath, { recursive: true, errorOnExist: true, force: false });
      } catch (error) {
        await rm(container, { recursive: true, force: true });
        throw error;
      }

      const leaseId = randomUUID();
      this.#leases.set(leaseId, container);
      return { leaseId, rootPath };
    } catch (error) {
      if (error instanceof TaskError) {
        throw error;
      }
      throw dependencyUnavailableError('Unable to provision fixture workspace', {
        details: { fixture: basename(input.workspaceId) },
      });
    }
  }

  async release(leaseId: string): Promise<void> {
    const container = this.#leases.get(leaseId);
    if (container === undefined) {
      return;
    }
    this.#leases.delete(leaseId);
    await rm(container, { recursive: true, force: true });
  }
}
