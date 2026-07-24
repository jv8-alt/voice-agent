"use client";

import type {
  ApprovalRequest,
  ClientMessage,
  SnapshotEnvelope,
  TurnMode,
  VoiceSession,
} from "@voice-agent/contracts";
import { OpenAIVoiceSession } from "@voice-agent/voice-openai";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TaskRestClient, TaskSocketClient } from "../../../lib/task-client";
import { initialTaskState, reduceTaskMessage } from "../../../lib/task-reducer";
import { TaskThread } from "../task-thread";

interface RestBoundary {
  get(taskId: string): Promise<SnapshotEnvelope>;
  create(input: { title: string; turn: { mode: TurnMode; text: string } }): Promise<SnapshotEnvelope>;
  createTurn(taskId: string, input: { mode: TurnMode; text: string }): Promise<unknown>;
  createVoiceClientSecret(): Promise<{ clientSecret: string }>;
}

interface SocketBoundary {
  connect(): Promise<void>;
  subscribe(listener: Parameters<TaskSocketClient["subscribe"]>[0]): () => unknown;
  send(command: ClientMessage): void;
  close(): void;
}

export interface TaskExperienceDependencies {
  readonly rest: RestBoundary;
  readonly socket: SocketBoundary;
  readonly voice: VoiceSession;
}

export interface TaskExperienceProps {
  readonly taskId: string;
  readonly initialMode: TurnMode;
  readonly dependencies?: TaskExperienceDependencies;
}

const draftEnvelope: SnapshotEnvelope = {
  snapshot: {
    task: {
      id: "new",
      title: "New voice task",
      status: "queued",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    turns: [],
    updates: [],
    pendingApproval: null,
  },
  lastEventId: null,
};

function defaultDependencies(): TaskExperienceDependencies {
  const apiUrl = process.env.NEXT_PUBLIC_TASK_API_URL ?? "http://localhost:3001";
  return {
    rest: new TaskRestClient(apiUrl),
    socket: new TaskSocketClient(apiUrl.replace(/^http/, "ws") + "/ws"),
    voice: new OpenAIVoiceSession(),
  };
}

export function TaskExperience({ taskId, initialMode, dependencies }: TaskExperienceProps) {
  const router = useRouter();
  const services = useMemo(() => dependencies ?? defaultDependencies(), [dependencies]);
  const [state, setState] = useState(() => ({
    ...initialTaskState,
    envelope: taskId === "new" ? draftEnvelope : null,
  }));
  const [error, setError] = useState<string | null>(null);
  const currentTaskId = useRef(taskId);
  const socketReady = useRef<Promise<void> | null>(null);
  const spokenUpdate = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    socketReady.current = services.socket.connect();
    const unsubscribe = services.socket.subscribe((message) => {
      if (active) setState((current) => reduceTaskMessage(current, message));
    });
    void services.rest.createVoiceClientSecret()
      .then(({ clientSecret }) => services.voice.connect({ clientSecret }))
      .catch(() => {
        if (active) setError("Voice is unavailable. You can still type your request.");
      });
    if (taskId !== "new") {
      void services.rest.get(taskId)
        .then(async (envelope) => {
          if (!active) return;
          setState({ envelope, needsResync: false, error: null });
          await socketReady.current;
          services.socket.send({ type: "task.subscribe", taskId, afterEventId: envelope.lastEventId });
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : "Unable to load task.");
        });
    }
    return () => {
      active = false;
      unsubscribe();
      services.socket.close();
      void services.voice.disconnect();
    };
  }, [services, taskId]);

  useEffect(() => {
    const update = state.envelope?.snapshot.updates.at(-1);
    if (update?.phase === "completed" && spokenUpdate.current !== update.createdAt) {
      spokenUpdate.current = update.createdAt;
      void services.voice.speak([update.headline, update.detail].filter(Boolean).join(". "));
    }
  }, [services.voice, state.envelope]);

  const submit = async (turn: { mode: TurnMode; text: string }) => {
    try {
      if (currentTaskId.current === "new") {
        const envelope = await services.rest.create({
          title: turn.text.slice(0, 72),
          turn,
        });
        currentTaskId.current = envelope.snapshot.task.id;
        setState({ envelope, needsResync: false, error: null });
        await socketReady.current;
        services.socket.send({
          type: "task.subscribe",
          taskId: currentTaskId.current,
          afterEventId: envelope.lastEventId,
        });
        router.replace(`/tasks/${currentTaskId.current}`);
      } else {
        await services.rest.createTurn(currentTaskId.current, turn);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit task.");
    }
  };

  const sendMutation = (
    command: ((taskId: string, commandId: string) => ClientMessage),
  ) => {
    if (currentTaskId.current !== "new") {
      services.socket.send(command(currentTaskId.current, crypto.randomUUID()));
    }
  };

  const resolveApproval = (approval: ApprovalRequest, decision: "approve" | "reject") =>
    sendMutation((activeTaskId, commandId) => ({
      type: "approval.resolve",
      taskId: activeTaskId,
      approvalId: approval.id,
      decision,
      commandId,
    }));

  if (!state.envelope) return <main className="loading">Loading task…</main>;
  return (
    <>
      {error && <p className="experience-error" role="status">{error}</p>}
      <TaskThread
        envelope={state.envelope}
        voice={services.voice}
        initialMode={initialMode}
        onSubmit={submit}
        onCancel={() => sendMutation((activeTaskId, commandId) => ({
          type: "task.cancel", taskId: activeTaskId, commandId,
        }))}
        onResolveApproval={resolveApproval}
      />
    </>
  );
}
