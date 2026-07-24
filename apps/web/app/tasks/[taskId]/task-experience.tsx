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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function voiceFailureMessage(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    message.includes("permission") ||
    message.includes("not allowed")
  ) {
    return "Microphone permission is blocked. Allow it in the browser address bar, then try again.";
  }
  if (name === "NotFoundError" || message.includes("not found") || message.includes("no microphone")) {
    return "No microphone was found. Connect one, or type your request.";
  }
  return "Voice needs microphone access. Allow the prompt, or type your request.";
}

async function microphonePermissionState(): Promise<PermissionState | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  try {
    return (await navigator.permissions.query({
      name: "microphone" as PermissionName,
    })).state;
  } catch {
    return "unsupported";
  }
}

function speakOutcome(text: string, voice: VoiceSession): void {
  const plainText = text.replace(/[`*_#]/g, "").trim();
  if (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  ) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(plainText);
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
    return;
  }
  void voice.speak(plainText).catch(() => {});
}

export function TaskExperience({ taskId, initialMode, dependencies }: TaskExperienceProps) {
  const router = useRouter();
  const services = useMemo(() => dependencies ?? defaultDependencies(), [dependencies]);
  const [state, setState] = useState(() => ({
    ...initialTaskState,
    envelope: taskId === "new" ? draftEnvelope : null,
  }));
  const [error, setError] = useState<string | null>(null);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const currentTaskId = useRef(taskId);
  const socketReady = useRef<Promise<void> | null>(null);
  const spokenUpdate = useRef<string | null>(null);
  const voiceConnect = useRef<Promise<boolean> | null>(null);
  const voiceReadyRef = useRef(false);
  const voiceGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    let socketStarted = false;
    let resolveSocketReady = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveSocketReady = resolve;
    });
    socketReady.current = ready;
    const connectTimer = window.setTimeout(() => {
      if (!active) {
        resolveSocketReady();
        return;
      }
      socketStarted = true;
      void services.socket.connect()
        .then(resolveSocketReady)
        .catch((cause: unknown) => {
          resolveSocketReady();
          if (active) {
            setError(cause instanceof Error ? cause.message : "Unable to connect to task updates.");
          }
        });
    }, 0);
    const unsubscribe = services.socket.subscribe((message) => {
      if (active) setState((current) => reduceTaskMessage(current, message));
    });
    if (taskId !== "new") {
      void services.rest.get(taskId)
        .then(async (envelope) => {
          if (!active) return;
          setState({ envelope, needsResync: false, error: null });
          await ready;
          if (active) {
            services.socket.send({
              type: "task.subscribe",
              taskId,
              afterEventId: envelope.lastEventId,
            });
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : "Unable to load task.");
        });
    }
    return () => {
      active = false;
      window.clearTimeout(connectTimer);
      resolveSocketReady();
      unsubscribe();
      if (socketStarted) services.socket.close();
    };
  }, [services, taskId]);

  useEffect(() => {
    return () => {
      voiceGeneration.current += 1;
      voiceConnect.current = null;
      voiceReadyRef.current = false;
      void services.voice.disconnect();
    };
  }, [services.voice]);

  useEffect(() => {
    const update = state.envelope?.snapshot.updates.at(-1);
    if (update?.phase === "completed" && spokenUpdate.current !== update.createdAt && voiceReady) {
      spokenUpdate.current = update.createdAt;
      speakOutcome([update.headline, update.detail].filter(Boolean).join(". "), services.voice);
    }
  }, [services.voice, state.envelope, voiceReady]);

  const enableVoice = useCallback(async () => {
    if (voiceReadyRef.current) return true;
    if (voiceConnect.current) return voiceConnect.current;

    const generation = ++voiceGeneration.current;
    setVoiceBusy(true);
    setVoiceHint("Waiting for microphone permission…");
    const pending = (async () => {
      try {
        const { clientSecret } = await services.rest.createVoiceClientSecret();
        await services.voice.connect({ clientSecret });
        if (voiceGeneration.current !== generation) return false;
        voiceReadyRef.current = true;
        setVoiceReady(true);
        setVoiceHint(null);
        setError(null);
        return true;
      } catch (cause) {
        if (voiceGeneration.current !== generation) return false;
        voiceReadyRef.current = false;
        setVoiceReady(false);
        setVoiceHint(voiceFailureMessage(cause));
        return false;
      } finally {
        if (voiceGeneration.current === generation) {
          voiceConnect.current = null;
          setVoiceBusy(false);
        }
      }
    })();
    voiceConnect.current = pending;
    return pending;
  }, [services.rest, services.voice]);

  useEffect(() => {
    if (initialMode === "typing") return;
    let active = true;
    void microphonePermissionState().then((permission) => {
      if (!active) return;
      if (permission === "granted") {
        void enableVoice();
      } else if (permission === "denied") {
        setVoiceHint(
          "Microphone permission is blocked. Allow it in the browser address bar, then try again.",
        );
      } else {
        setVoiceHint("Allow microphone access to talk.");
      }
    });
    return () => {
      active = false;
    };
  }, [enableVoice, initialMode]);

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
      {voiceHint && (
        <div className="experience-error voice-permission" role="status">
          <p>{voiceHint}</p>
          <button
            type="button"
            className="primary"
            disabled={voiceBusy}
            onClick={() => { void enableVoice(); }}
          >
            {voiceBusy ? "Requesting…" : "Allow microphone"}
          </button>
        </div>
      )}
      <TaskThread
        envelope={state.envelope}
        voice={services.voice}
        initialMode={initialMode}
        ensureVoice={enableVoice}
        onSubmit={submit}
        onCancel={() => sendMutation((activeTaskId, commandId) => ({
          type: "task.cancel", taskId: activeTaskId, commandId,
        }))}
        onResolveApproval={resolveApproval}
      />
    </>
  );
}
