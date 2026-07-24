import { describe, expect, it } from 'vitest';
import {
  ApprovalRequestSchema,
  CodingEventSchema,
  ExecutiveUpdateSchema,
  ProposedActionSchema,
  TaskSchema,
  TaskSnapshotSchema,
  TechnicalSummarySchema,
  TurnSchema,
} from './domain.js';

const now = '2026-07-24T18:00:00.000Z';

const validTask = {
  id: 'task-1',
  actorId: 'demo-user',
  workspaceId: 'workspace-1',
  fixtureId: 'checkout-regression',
  title: 'Fix the checkout bug',
  status: 'working',
  agentThreadId: null,
  createdAt: now,
  updatedAt: now,
};

const validTurn = {
  id: 'turn-1',
  taskId: 'task-1',
  mode: 'ptt',
  text: 'Fix the checkout bug',
  createdAt: now,
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
  actions: [validAction],
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

describe('TaskSchema', () => {
  it('accepts a valid task', () => {
    expect(TaskSchema.safeParse(validTask).success).toBe(true);
  });

  it('rejects a task missing a required field', () => {
    const { title: _title, ...withoutTitle } = validTask;
    expect(TaskSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('rejects an invalid status enum value', () => {
    expect(TaskSchema.safeParse({ ...validTask, status: 'in_progress' }).success).toBe(false);
  });

  it('rejects the wrong type for createdAt', () => {
    expect(TaskSchema.safeParse({ ...validTask, createdAt: 12345 }).success).toBe(false);
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
    task: validTask,
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
      TaskSnapshotSchema.safeParse({ ...validSnapshot, task: { ...validTask, status: 'bogus' } }).success,
    ).toBe(false);
  });
});
