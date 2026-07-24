import { describe, expect, it } from 'vitest';
import {
  ApprovalRequestSchema,
  ApprovalRecordSchema,
  ActionViewSchema,
  CodingEventSchema,
  ExecutiveUpdateSchema,
  ProposedActionSchema,
  SnapshotEnvelopeSchema,
  TaskRecordSchema,
  TaskViewSchema,
  TaskSnapshotSchema,
  TechnicalSummarySchema,
  TurnSchema,
} from './domain.js';

const now = '2026-07-24T18:00:00.000Z';

const validTaskRecord = {
  id: 'task-1',
  actorId: 'demo-user',
  workspaceId: 'workspace-1',
  title: 'Fix the checkout bug',
  agentThreadId: null,
  createdAt: now,
  updatedAt: now,
};
const validTaskView = {
  id: 'task-1',
  title: 'Fix the checkout bug',
  status: 'working',
  createdAt: now,
  updatedAt: now,
};

const validTurn = {
  id: 'turn-1',
  taskId: 'task-1',
  mode: 'ptt',
  text: 'Fix the checkout bug',
  status: 'working',
  createdAt: now,
  updatedAt: now,
};

const validAction = {
  kind: 'write',
  summary: 'Edit checkout.ts',
  paths: ['src/checkout.ts'],
};

const validUpdate = {
  taskId: 'task-1',
  turnId: 'turn-1',
  phase: 'working',
  headline: 'Looking into the checkout flow',
  createdAt: now,
};

const validApproval = {
  id: 'approval-1',
  taskId: 'task-1',
  turnId: 'turn-1',
  reason: 'Destructive git operation requested',
  actions: [{ kind: 'write', summary: 'Edit checkout.ts' }],
  createdAt: now,
};

const validTechnicalSummary = {
  taskId: 'task-1',
  turnId: 'turn-1',
  narrative: 'Edited checkout.ts to fix rounding.',
  toolsUsed: ['apply_patch'],
  filesTouched: ['src/checkout.ts'],
  createdAt: now,
};

describe('task records and views', () => {
  it('accepts internal records and browser-safe views', () => {
    expect(TaskRecordSchema.safeParse(validTaskRecord).success).toBe(true);
    expect(TaskViewSchema.safeParse(validTaskView).success).toBe(true);
  });

  it('rejects a task missing a required field', () => {
    const { title: _title, ...withoutTitle } = validTaskRecord;
    expect(TaskRecordSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('keeps internal identifiers out of public views', () => {
    expect(TaskViewSchema.safeParse({ ...validTaskView, actorId: 'leak' }).success).toBe(false);
  });

  it('rejects the wrong type for createdAt', () => {
    expect(TaskRecordSchema.safeParse({ ...validTaskRecord, createdAt: 12345 }).success).toBe(false);
  });
});

describe('TurnSchema', () => {
  it('accepts a valid turn', () => {
    expect(TurnSchema.safeParse(validTurn).success).toBe(true);
  });

  it('rejects an invalid mode', () => {
    expect(TurnSchema.safeParse({ ...validTurn, mode: 'video' }).success).toBe(false);
  });

  it('rejects an empty text field', () => {
    expect(TurnSchema.safeParse({ ...validTurn, text: '' }).success).toBe(false);
  });
});

describe('ProposedActionSchema', () => {
  it('accepts a valid action', () => {
    expect(ProposedActionSchema.safeParse(validAction).success).toBe(true);
  });

  it('rejects an invalid kind', () => {
    expect(ProposedActionSchema.safeParse({ ...validAction, kind: 'delete' }).success).toBe(false);
  });
});

describe('CodingEventSchema', () => {
  it('accepts each known discriminant', () => {
    expect(CodingEventSchema.safeParse({ type: 'thread_ready', threadId: 't-1' }).success).toBe(true);
    expect(CodingEventSchema.safeParse({ type: 'plan_ready', actions: [validAction] }).success).toBe(true);
    expect(CodingEventSchema.safeParse({ type: 'message', text: 'hi' }).success).toBe(true);
    expect(
      CodingEventSchema.safeParse({ type: 'tool_finished', tool: 'apply_patch', summary: 'ok', ok: true }).success,
    ).toBe(true);
  });

  it('rejects an unknown discriminant', () => {
    expect(CodingEventSchema.safeParse({ type: 'unknown_event' }).success).toBe(false);
  });

  it('rejects a variant missing its required field', () => {
    expect(CodingEventSchema.safeParse({ type: 'thread_ready' }).success).toBe(false);
  });

  it('rejects a failed event whose error does not match the pinned error shape', () => {
    expect(CodingEventSchema.safeParse({ type: 'failed', error: { code: 'oops' } }).success).toBe(false);
  });
});

describe('ExecutiveUpdateSchema', () => {
  it('accepts a valid update', () => {
    expect(ExecutiveUpdateSchema.safeParse(validUpdate).success).toBe(true);
  });

  it('rejects a phase outside the frozen phase vocabulary', () => {
    expect(ExecutiveUpdateSchema.safeParse({ ...validUpdate, phase: 'queued' }).success).toBe(false);
  });
});

describe('ApprovalRequestSchema', () => {
  it('accepts a valid approval request', () => {
    expect(ApprovalRequestSchema.safeParse(validApproval).success).toBe(true);
  });

  it('rejects an empty actions array', () => {
    expect(ApprovalRequestSchema.safeParse({ ...validApproval, actions: [] }).success).toBe(false);
  });

  it('separates internal actions from public action views', () => {
    expect(ActionViewSchema.safeParse({ kind: 'write', summary: 'Edit a file', command: 'rm -rf /' }).success).toBe(false);
    expect(ApprovalRecordSchema.safeParse({
      ...validApproval,
      actions: [validAction],
      status: 'pending',
      resolvedAt: null,
    }).success).toBe(true);
  });
});

describe('TechnicalSummarySchema', () => {
  it('accepts a valid technical summary', () => {
    expect(TechnicalSummarySchema.safeParse(validTechnicalSummary).success).toBe(true);
  });

  it('rejects filesTouched of the wrong type', () => {
    expect(TechnicalSummarySchema.safeParse({ ...validTechnicalSummary, filesTouched: 'checkout.ts' }).success).toBe(
      false,
    );
  });
});

describe('TaskSnapshotSchema', () => {
  const validSnapshot = {
    task: validTaskView,
    turns: [validTurn],
    updates: [validUpdate],
    pendingApproval: null,
  };

  it('accepts a valid snapshot with no pending approval', () => {
    expect(TaskSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it('accepts a valid snapshot with a pending approval', () => {
    expect(TaskSnapshotSchema.safeParse({ ...validSnapshot, pendingApproval: validApproval }).success).toBe(true);
  });

  it('rejects a snapshot with a malformed nested task', () => {
    expect(
      TaskSnapshotSchema.safeParse({ ...validSnapshot, task: { ...validTaskView, status: 'bogus' } }).success,
    ).toBe(false);
  });

  it('wraps snapshots with an atomic replay cursor', () => {
    expect(SnapshotEnvelopeSchema.safeParse({ snapshot: validSnapshot, lastEventId: '42' }).success).toBe(true);
  });
});
