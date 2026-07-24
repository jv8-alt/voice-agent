import type { SnapshotEnvelope, VoiceSession, VoiceTranscriptEvent } from "@voice-agent/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { TaskThread } from "./task-thread";

const now = "2026-07-24T19:58:00.000Z";
const envelope = (status: "working" | "needs_input" | "completed" = "working"): SnapshotEnvelope => ({
  snapshot: {
    task: { id: "task-1", title: "Checkout", status, createdAt: now, updatedAt: now },
    turns: [{ id: "turn-1", taskId: "task-1", mode: "ptt", text: "Fix checkout", status, createdAt: now, updatedAt: now }],
    updates: status === "completed"
      ? [{ taskId: "task-1", turnId: "turn-1", phase: "completed", headline: "Fixed", detail: "Tests passed", createdAt: now }]
      : [],
    pendingApproval: status === "needs_input" ? {
      id: "approval-1", taskId: "task-1", turnId: "turn-1", reason: "Rollback is destructive",
      actions: [{ kind: "write", summary: "Rollback retry change" }], createdAt: now,
    } : null,
  },
  lastEventId: "4",
});

class TestVoice implements VoiceSession {
  listener: ((event: VoiceTranscriptEvent) => void) | undefined;
  connect = vi.fn();
  disconnect = vi.fn();
  startTurn = vi.fn();
  stopTurn = vi.fn();
  speak = vi.fn();
  onInterrupted = vi.fn(() => () => {});
  onTranscript(listener: (event: VoiceTranscriptEvent) => void) {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }
}

describe("task thread", () => {
  it("submits a final voice transcript immediately", () => {
    const voice = new TestVoice();
    const submit = vi.fn();
    render(<TaskThread envelope={envelope()} voice={voice} onSubmit={submit} onCancel={() => {}} onResolveApproval={() => {}} />);

    voice.listener?.({ text: "  Check mobile Safari  ", final: true });

    expect(submit).toHaveBeenCalledWith({ mode: "ptt", text: "Check mobile Safari" });
    expect(screen.queryByText("Check mobile Safari")).not.toBeInTheDocument();
  });

  it("ends push-to-talk on pointer up or cancel, even after leaving the mic", () => {
    const voice = new TestVoice();
    render(<TaskThread envelope={envelope()} voice={voice} onCancel={() => {}} onResolveApproval={() => {}} />);
    const mic = screen.getByRole("button", { name: "Hold to talk" });
    const setPointerCapture = vi.fn();
    Object.defineProperty(mic, "setPointerCapture", { configurable: true, value: setPointerCapture });

    fireEvent.pointerDown(mic, { pointerId: 1 });
    expect(voice.startTurn).toHaveBeenCalledWith("ptt");
    expect(setPointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerUp(mic);
    expect(voice.stopTurn).toHaveBeenCalledOnce();

    voice.stopTurn.mockClear();
    fireEvent.pointerDown(mic, { pointerId: 2 });
    fireEvent.pointerCancel(mic);
    expect(voice.stopTurn).toHaveBeenCalledOnce();
  });

  it("renders working, cancel, approval, and completed outcomes", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    const resolve = vi.fn();
    const { rerender } = render(<TaskThread envelope={envelope()} onCancel={cancel} onResolveApproval={resolve} />);

    expect(screen.getByText("Working on it")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel task" }));
    expect(cancel).toHaveBeenCalledOnce();

    rerender(<TaskThread envelope={envelope("needs_input")} onCancel={cancel} onResolveApproval={resolve} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(resolve).toHaveBeenCalledWith(envelope("needs_input").snapshot.pendingApproval, "approve");

    rerender(<TaskThread envelope={envelope("completed")} onCancel={cancel} onResolveApproval={resolve} />);
    expect(screen.getByText("Tests passed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel task" })).not.toBeInTheDocument();
  });

  it("keeps typing as a functional fallback", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<TaskThread envelope={envelope()} onSubmit={submit} onCancel={() => {}} onResolveApproval={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Switch to typing" }));
    await user.type(screen.getByPlaceholderText("Ask a follow-up…"), "Run the mobile tests");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(submit).toHaveBeenCalledWith({ mode: "typing", text: "Run the mobile tests" });
  });
});
