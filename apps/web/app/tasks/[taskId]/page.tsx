import type { SnapshotEnvelope } from "@voice-agent/contracts";
import React from "react";
import { TaskThread } from "../task-thread";

const now = "2026-07-24T19:58:00.000Z";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const envelope: SnapshotEnvelope = {
    snapshot: {
      task: { id: taskId, title: "Fix checkout regression", status: "working", createdAt: now, updatedAt: now },
      turns: [{ id: "turn-1", taskId, mode: "ptt", text: "Find why checkout conversion dropped.", status: "working", createdAt: now, updatedAt: now }],
      updates: [{ taskId, turnId: "turn-1", phase: "understood", headline: "I understand the task", detail: "I’ll compare the deploy changes with checkout errors.", createdAt: now }],
      pendingApproval: null,
    },
    lastEventId: "2",
  };

  return <TaskThread envelope={envelope} />;
}
