import type {
  ApprovalRequest,
  ExecutiveUpdate,
  ServerMessage,
  SnapshotEnvelope,
  TaskView,
  Turn,
} from "@voice-agent/contracts";

export interface TaskState {
  envelope: SnapshotEnvelope | null;
  needsResync: boolean;
  error: string | null;
}

export const initialTaskState: TaskState = { envelope: null, needsResync: false, error: null };

function update(
  state: TaskState,
  change: {
    task?: TaskView;
    turn?: Turn;
    update?: ExecutiveUpdate;
    approval?: ApprovalRequest | null;
    eventId?: string;
  },
): TaskState {
  const current = state.envelope?.snapshot;
  const task = change.task ?? current?.task;
  if (!task) return state;
  const turns = current?.turns ?? [];
  const nextTurns = change.turn
    ? [...turns.filter((turn) => turn.id !== change.turn?.id), change.turn]
    : turns;
  return {
    ...state,
    envelope: {
      snapshot: {
        task,
        turns: nextTurns,
        updates: change.update ? [...(current?.updates ?? []), change.update] : (current?.updates ?? []),
        pendingApproval: change.approval === undefined ? (current?.pendingApproval ?? null) : change.approval,
      },
      lastEventId: change.eventId ?? state.envelope?.lastEventId ?? null,
    },
  };
}

function setTurnStatus(state: TaskState, turnId: string | null, status: Turn["status"], eventId: string) {
  const current = state.envelope;
  if (!current) return state;
  const turns = current.snapshot.turns.map((turn) =>
    turn.id === turnId ? { ...turn, status, updatedAt: new Date().toISOString() } : turn);
  return {
    ...state,
    envelope: {
      snapshot: { ...current.snapshot, task: { ...current.snapshot.task, status }, turns },
      lastEventId: eventId,
    },
  };
}

export function reduceTaskMessage(state: TaskState, message: ServerMessage): TaskState {
  switch (message.type) {
    case "task.snapshot":
      return { envelope: { snapshot: message.snapshot, lastEventId: message.lastEventId }, needsResync: false, error: null };
    case "task.created":
      return update(state, { task: message.task, eventId: message.eventId });
    case "turn.created":
      return update(state, { turn: message.turn, eventId: message.eventId });
    case "progress.updated":
      return update(state, { update: message.update, eventId: message.eventId });
    case "approval.required":
      return update(state, { approval: message.approval, eventId: message.eventId });
    case "approval.resolved":
      return update(state, { approval: null, eventId: message.eventId });
    case "turn.status_changed":
      return setTurnStatus(state, message.turnId, message.status, message.eventId);
    case "task.completed":
      return update(setTurnStatus(state, message.turnId, "completed", message.eventId), {
        update: message.update,
        eventId: message.eventId,
      });
    case "task.cancelled":
      return setTurnStatus(state, message.turnId, "cancelled", message.eventId);
    case "task.failed":
      return { ...setTurnStatus(state, message.turnId, "failed", message.eventId), error: message.error.message };
    case "resync_required":
      return { ...state, needsResync: true };
    case "error":
      return { ...state, error: message.error.message };
    case "connection.ready":
    case "intent.confirmed":
      return "eventId" in message
        ? update(state, { eventId: message.eventId })
        : state;
  }
}
