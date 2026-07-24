import type { VoiceTranscriptEvent } from "@voice-agent/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeVoiceStarter } from "./home-voice-starter";
import Home from "./page";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("voice-first home", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("puts every voice action before recent tasks", () => {
    render(<Home />);

    const controls = [
      screen.getByRole("button", { name: /hold to talk/i }),
      screen.getByRole("link", { name: /hands-free/i }),
      screen.getByRole("link", { name: /type instead/i }),
    ];
    const recent = screen.getByRole("heading", { name: /recent tasks/i });

    controls.forEach((control) => {
      expect(control.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("links start modes and live recent tasks to their destinations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tasks: [{
        id: "checkout",
        title: "Fix checkout regression",
        status: "working",
        createdAt: "2026-07-24T18:00:00.000Z",
        updatedAt: "2026-07-24T19:58:00.000Z",
      }],
    }), { status: 200 })));
    render(<Home />);

    expect(screen.getByRole("button", { name: /hold to talk/i })).toBeInTheDocument();
    const recent = screen.getByRole("navigation", { name: /recent tasks/i });
    expect(await within(recent).findByRole("link", { name: /fix checkout regression/i })).toHaveAttribute(
      "href",
      "/tasks/checkout",
    );
  });

  it("captures while held and creates the task after release", async () => {
    let transcript: ((event: VoiceTranscriptEvent) => void) | undefined;
    const voice = {
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      startTurn: vi.fn(),
      stopTurn: vi.fn(),
      speak: vi.fn(async () => {}),
      onTranscript: vi.fn((listener: (event: VoiceTranscriptEvent) => void) => {
        transcript = listener;
        return () => {};
      }),
      onInterrupted: vi.fn(() => () => {}),
    };
    const rest = {
      createVoiceClientSecret: vi.fn(async () => ({ clientSecret: "test-secret" })),
      create: vi.fn(async () => ({
        snapshot: {
          task: {
            id: "task-1",
            title: "Fix checkout",
            status: "queued" as const,
            createdAt: "2026-07-24T18:00:00.000Z",
            updatedAt: "2026-07-24T18:00:00.000Z",
          },
          turns: [],
          updates: [],
          pendingApproval: null,
        },
        lastEventId: "1",
      })),
    };
    render(<HomeVoiceStarter dependencies={{ rest, voice }} />);
    const button = screen.getByRole("button", { name: "Hold to talk" });
    Object.defineProperty(button, "setPointerCapture", { configurable: true, value: vi.fn() });

    fireEvent.pointerDown(button, { pointerId: 1 });
    await waitFor(() => expect(voice.startTurn).toHaveBeenCalledWith("ptt"));
    expect(screen.getByRole("button", { name: "Listening… release to send" }))
      .toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(voice.stopTurn).toHaveBeenCalledOnce();

    act(() => transcript?.({ text: "Fix checkout", final: true }));
    await waitFor(() => expect(rest.create).toHaveBeenCalledWith({
      title: "Fix checkout",
      turn: { mode: "ptt", text: "Fix checkout" },
    }));
    expect(router.push).toHaveBeenCalledWith("/tasks/task-1");
  });
});
