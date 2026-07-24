import { MemoryCommandReceiptStore } from './command-receipt-store.js';
import { MemoryTaskState } from './state.js';
import { MemoryTaskEventLog } from './task-event-log.js';
import { MemoryTaskRunRegistry } from './task-run-registry.js';
import { MemoryTaskStore } from './task-store.js';

export {
  MemoryCommandReceiptStore,
  MemoryTaskEventLog,
  MemoryTaskRunRegistry,
  MemoryTaskState,
  MemoryTaskStore,
};

export interface MemoryTaskAdapters {
  readonly taskStore: MemoryTaskStore;
  readonly eventLog: MemoryTaskEventLog;
  readonly commandReceipts: MemoryCommandReceiptStore;
  readonly runRegistry: MemoryTaskRunRegistry;
}

export interface CreateMemoryTaskAdaptersOptions {
  readonly replayCapacity?: number;
}

export function createMemoryTaskAdapters(
  options: CreateMemoryTaskAdaptersOptions = {},
): MemoryTaskAdapters {
  const state = new MemoryTaskState(options.replayCapacity);
  return {
    taskStore: new MemoryTaskStore(state),
    eventLog: new MemoryTaskEventLog(state),
    commandReceipts: new MemoryCommandReceiptStore(),
    runRegistry: new MemoryTaskRunRegistry(),
  };
}
