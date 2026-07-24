import type {
  ClientMessage,
  ServerMessage,
  SnapshotEnvelope,
  VoiceSession,
  VoiceTranscriptEvent,
} from "@voice-agent/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TaskExperience,
  type TaskExperienceDependencies,
} from "./task-experience";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const now = "2026-07-24T20:00:00.000Z";
function envelope(status: "working" | "needs_input" | "completed" = "working"): SnapshotEnvelope {
  return {
    snapshot: {
      task: { id: "task-1", title: "Fix greeting", status, createdAt: now, updatedAt: now },
      turns: [{ id: "turn-1", taskId: "task-1", mode: "ptt", text: "Fix greeting", status, createdAt: now, updatedAt: now }],
      updates: [],
      pendingApproval: status === "needs_input" ? {
        id: "approval-1",
        taskId: "task-1",
        turnId: "turn-1",
        reason: "This change needs approval.",
        actions: [{ kind: "write", summary: "Change greeting" }],
        createdAt: now,
      } : null,
    },
    lastEventId: "3",
  };
}

class FakeVoice implements VoiceSession {
  listener: ((event: VoiceTranscriptEvent) => void) | undefined;
  connect = vi.fn(async () => {});
  disconnect = vi.fn(async () => {});
  startTurn = vi.fn();
  stopTurn = vi.fn();
  speak = vi.fn(async () => {});
  onTranscript(listener: (event: VoiceTranscriptEvent) => void) {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }
  onInterrupted() { return () => {}; }
}

function setup(initial = envelope()) {
  const voice = new FakeVoice();
  let listener: ((message: ServerMessage) => void) | undefined;
  const sent: ClientMessage[] = [];
  const rest = {
    get: vi.fn(async () => initial),
    create: vi.fn(async () => initial),
    createTurn: vi.fn(async () => initial.snapshot.turns[0]),
    createVoiceClientSecret: vi.fn(async () => ({ clientSecret: "test-secret" })),
  };
  const socket = {
    connect: vi.fn(async () => {}),
    subscribe: vi.fn((next: (message: ServerMessage) => void) => {
      listener = next;
      return () => { listener = undefined; };
    }),
    send: vi.fn((message: ClientMessage) => sent.push(message)),
    close: vi.fn(),
  };
  return {
    dependencies: { rest, socket, voice } satisfies TaskExperienceDependencies,
    rest,
    socket,
    voice,
    sent,
    emit: (message: ServerMessage) => listener?.(message),
  };
}

describe("mobile golden paths", () => {
  it("prompts for microphone before connecting voice, then submits a final transcript", async () => {
    const user = userEvent.setup();
    const test = setup();
    render(<TaskExperience taskId="new" initialMode="ptt" dependencies={test.dependencies} />);

    expect(test.voice.connect).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Allow microphone" }));
    await waitFor(() => expect(test.voice.connect).toHaveBeenCalledWith({ clientSecret: "test-secret" }));
    expect(screen.queryByRole("button", { name: "Allow microphone" })).not.toBeInTheDocument();

    test.voice.listener?.({ text: "Fix the greeting", final: true });
    await waitFor(() => expect(test.rest.create).toHaveBeenCalledWith({
      title: "Fix the greeting",
      turn: { mode: "ptt", text: "Fix the greeting" },
    }));
    test.emit({
      type: "task.completed",
      eventId: "4",
      taskId: "task-1",
      turnId: "turn-1",
      update: {
        taskId: "task-1",
        turnId: "turn-1",
        phase: "completed",
        headline: "Greeting fixed",
        createdAt: now,
      },
    });
    expect(await screen.findByText("Greeting fixed")).toBeInTheDocument();
  });

  it("connects automatically when microphone permission was already granted", async () => {
    const originalPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({ state: "granted" }) as PermissionStatus),
      },
    });
    try {
      const test = setup();
      render(<TaskExperience taskId="new" initialMode="ptt" dependencies={test.dependencies} />);

      await waitFor(() =>
        expect(test.voice.connect).toHaveBeenCalledWith({ clientSecret: "test-secret" }),
      );
      expect(screen.queryByRole("button", { name: "Allow microphone" })).not.toBeInTheDocument();
    } finally {
      if (originalPermissions) {
        Object.defineProperty(navigator, "permissions", originalPermissions);
      } else {
        Reflect.deleteProperty(navigator, "permissions");
      }
    }
  });

  it("explains blocked microphone permission and keeps typing available", async () => {
    const user = userEvent.setup();
    const test = setup();
    test.voice.connect.mockRejectedValueOnce(
      Object.assign(new DOMException("Permission denied", "NotAllowedError")),
    );
    render(<TaskExperience taskId="new" initialMode="ptt" dependencies={test.dependencies} />);

    await user.click(await screen.findByRole("button", { name: "Allow microphone" }));
    expect(await screen.findByText(/Microphone permission is blocked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
  });

  it("sends an idempotent cancellation command", async () => {
    const test = setup();
    render(<TaskExperience taskId="task-1" initialMode="ptt" dependencies={test.dependencies} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel task" }));
    expect(test.sent.at(-1)).toMatchObject({ type: "task.cancel", taskId: "task-1" });
    expect(test.sent.at(-1)).toHaveProperty("commandId");
  });

  it("opens and subscribes one task socket under React Strict Mode", async () => {
    const test = setup();
    render(
      <React.StrictMode>
        <TaskExperience
          taskId="task-1"
          initialMode="typing"
          dependencies={test.dependencies}
        />
      </React.StrictMode>,
    );

    await waitFor(() => expect(test.socket.connect).toHaveBeenCalledOnce());
    await waitFor(() => expect(test.sent).toContainEqual({
      type: "task.subscribe",
      taskId: "task-1",
      afterEventId: "3",
    }));
  });

  it("keeps the voice session connected when a new task transitions to its ID route", async () => {
    const test = setup();
    const view = render(
      <TaskExperience
        taskId="new"
        initialMode="handsfree"
        dependencies={test.dependencies}
      />,
    );
    await waitFor(() =>
      expect(test.voice.connect).toHaveBeenCalledWith({ clientSecret: "test-secret" }),
    );

    view.rerender(
      <TaskExperience
        taskId="task-1"
        initialMode="handsfree"
        dependencies={test.dependencies}
      />,
    );
    await waitFor(() => expect(test.rest.get).toHaveBeenCalledWith("task-1"));

    expect(test.voice.disconnect).not.toHaveBeenCalled();
  });

  it("resolves a sensitive approval over the task socket", async () => {
    const test = setup(envelope("needs_input"));
    render(<TaskExperience taskId="task-1" initialMode="handsfree" dependencies={test.dependencies} />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(test.sent.at(-1)).toMatchObject({
      type: "approval.resolve",
      taskId: "task-1",
      approvalId: "approval-1",
      decision: "approve",
    });
  });
});
