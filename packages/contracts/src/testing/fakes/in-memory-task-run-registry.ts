import { conflictError } from '../../errors.js';
import type { ActiveRunHandle, BeginRunInput, TaskRunRegistry } from '../../ports/task-run-registry.js';

/** Reference {@link TaskRunRegistry} implementation: an in-process `Map<taskId, ActiveRunHandle>`, exactly as documented for the demo adapter. */
export class InMemoryFakeTaskRunRegistry implements TaskRunRegistry {
  private readonly active = new Map<string, ActiveRunHandle>();

  begin(input: BeginRunInput): ActiveRunHandle {
    if (this.active.has(input.taskId)) {
      throw conflictError(`Task "${input.taskId}" already has an active run.`, {
        details: { taskId: input.taskId },
      });
    }

    const controller = new AbortController();
    const handle: ActiveRunHandle = {
      taskId: input.taskId,
      turnId: input.turnId,
      signal: controller.signal,
      abort: () => controller.abort(),
    };
    this.active.set(input.taskId, handle);
    return handle;
  }

  end(taskId: string): void {
    this.active.delete(taskId);
  }

  getActive(taskId: string): ActiveRunHandle | null {
    return this.active.get(taskId) ?? null;
  }

  cancel(taskId: string): boolean {
    const handle = this.active.get(taskId);
    if (!handle) {
      return false;
    }
    handle.abort();
    this.active.delete(taskId);
    return true;
  }
}
