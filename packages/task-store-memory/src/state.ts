import type {
  ApprovalRecord,
  ExecutiveUpdate,
  TaskEventRecord,
  TaskRecord,
  Turn,
} from '@voice-agent/contracts';

export interface MemoryEventStream {
  nextId: bigint;
  retentionFloorEventId: string | null;
  records: TaskEventRecord[];
}

export class MemoryTaskState {
  readonly tasks = new Map<string, TaskRecord>();
  readonly turns = new Map<string, Turn>();
  readonly turnsByTask = new Map<string, string[]>();
  readonly updatesByTask = new Map<string, ExecutiveUpdate[]>();
  readonly approvals = new Map<string, ApprovalRecord>();
  readonly eventStreams = new Map<string, MemoryEventStream>();

  constructor(readonly replayCapacity = 100) {
    if (!Number.isSafeInteger(replayCapacity) || replayCapacity < 1) {
      throw new Error('replayCapacity must be a positive safe integer');
    }
  }

  streamKey(actorId: string, taskId: string): string {
    return `${actorId}\0${taskId}`;
  }
}

export function copy<T>(value: T): T {
  return structuredClone(value);
}
