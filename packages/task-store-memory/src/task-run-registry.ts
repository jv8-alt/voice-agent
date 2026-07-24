import {
  conflictError,
  type ActiveRunHandle,
  type BeginRunInput,
  type TaskRunRegistry,
} from '@voice-agent/contracts';

export class MemoryTaskRunRegistry implements TaskRunRegistry {
  private readonly active = new Map<string, ActiveRunHandle>();

  begin(input: BeginRunInput): ActiveRunHandle {
    if (this.active.has(input.taskId)) {
      throw conflictError(`Task "${input.taskId}" already has an active run.`, {
        details: { taskId: input.taskId },
      });
    }
    const controller = new AbortController();
    const handle: ActiveRunHandle = {
      ...input,
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
    if (!handle) return false;
    handle.abort();
    this.active.delete(taskId);
    return true;
  }
}
