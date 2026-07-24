import type { ServerMessage } from "@voice-agent/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskRestClient, TaskSocketClient } from "./task-client";
import { initialTaskState, reduceTaskMessage } from "./task-reducer";

const now = "2026-07-24T19:58:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("task REST client", () => {
  it("calls the browser fetch function with its required global receiver", async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify({
        clientSecret: "test-secret",
        expiresAt: now,
      })));
    });
    vi.stubGlobal("fetch", browserFetch);

    await expect(new TaskRestClient("http://tasks").createVoiceClientSecret())
      .resolves.toMatchObject({ clientSecret: "test-secret" });
  });
});

describe("task replay reducer", () => {
  it("reconstructs public task state from replayable events", () => {
    const replay: ServerMessage[] = [
      { type: "task.created", eventId: "1", task: { id: "task-1", title: "Checkout", status: "queued", createdAt: now, updatedAt: now } },
      { type: "turn.created", eventId: "2", turn: { id: "turn-1", taskId: "task-1", mode: "ptt", text: "Fix checkout", status: "queued", createdAt: now, updatedAt: now } },
      { type: "turn.status_changed", eventId: "3", taskId: "task-1", turnId: "turn-1", status: "working" },
      { type: "progress.updated", eventId: "4", update: { taskId: "task-1", turnId: "turn-1", phase: "working", headline: "Testing mobile", createdAt: now } },
      { type: "task.completed", eventId: "5", taskId: "task-1", turnId: "turn-1", update: { taskId: "task-1", turnId: "turn-1", phase: "completed", headline: "Fixed", createdAt: now } },
    ];

    const state = replay.reduce(reduceTaskMessage, initialTaskState);

    expect(state.envelope?.snapshot.task).toMatchObject({ id: "task-1", status: "completed" });
    expect(state.envelope?.snapshot.turns).toHaveLength(1);
    expect(state.envelope?.snapshot.updates.map(({ headline }) => headline)).toEqual(["Testing mobile", "Fixed"]);
    expect(state.envelope?.lastEventId).toBe("5");
  });

  it("uses the corrected snapshot envelope cursor and requests resync explicitly", () => {
    const snapshot: ServerMessage = {
      type: "task.snapshot", taskId: "task-1", lastEventId: "9",
      snapshot: {
        task: { id: "task-1", title: "Checkout", status: "working", createdAt: now, updatedAt: now },
        turns: [], updates: [], pendingApproval: null,
      },
    };
    const loaded = reduceTaskMessage(initialTaskState, snapshot);
    expect(loaded.envelope?.lastEventId).toBe("9");
    expect(reduceTaskMessage(loaded, { type: "resync_required", taskId: "task-1" }).needsResync).toBe(true);
  });

  it("derives task status from a newly created follow-up turn", () => {
    const completed = reduceTaskMessage(initialTaskState, {
      type: "task.snapshot", taskId: "task-1", lastEventId: "9",
      snapshot: {
        task: { id: "task-1", title: "Checkout", status: "completed", createdAt: now, updatedAt: now },
        turns: [{ id: "turn-1", taskId: "task-1", mode: "ptt", text: "Fix checkout", status: "completed", createdAt: now, updatedAt: now }],
        updates: [], pendingApproval: null,
      },
    });

    const followedUp = reduceTaskMessage(completed, {
      type: "turn.created", eventId: "10",
      turn: { id: "turn-2", taskId: "task-1", mode: "typing", text: "Also add coverage", status: "queued", createdAt: now, updatedAt: now },
    });

    expect(followedUp.envelope?.snapshot.task.status).toBe("queued");
    expect(followedUp.envelope?.snapshot.turns.map(({ status }) => status)).toEqual(["completed", "queued"]);
  });
});

class TestSocket {
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, ((event: Event | MessageEvent) => void)[]>();
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  addEventListener(type: "open" | "message", listener: (event: Event | MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  open() {
    this.readyState = 1;
    this.listeners.get("open")?.forEach((listener) => listener(new Event("open")));
  }
  receive(message: ServerMessage) {
    this.listeners.get("message")?.forEach((listener) =>
      listener(new MessageEvent("message", { data: JSON.stringify(message) })));
  }
}

describe("task socket commands", () => {
  it("retries a mutation with the same commandId until acknowledged", () => {
    const sockets: TestSocket[] = [];
    const client = new TaskSocketClient("ws://tasks", () => {
      const socket = new TestSocket();
      sockets.push(socket);
      return socket;
    });
    const command = { type: "task.cancel", taskId: "task-1", commandId: "command-1" } as const;

    client.connect();
    client.send(command);
    sockets[0]?.open();
    expect(JSON.parse(sockets[0]?.sent[0] ?? "")).toEqual(command);

    client.connect();
    sockets[1]?.open();
    expect(JSON.parse(sockets[1]?.sent[0] ?? "")).toEqual(command);
    sockets[1]?.receive({ type: "task.cancelled", eventId: "10", taskId: "task-1", turnId: "turn-1", commandId: "command-1" });

    client.connect();
    sockets[2]?.open();
    expect(sockets[2]?.sent).toEqual([]);
  });

  it("closes and ignores the prior socket when reconnecting", () => {
    const sockets: TestSocket[] = [];
    const received: ServerMessage[] = [];
    const client = new TaskSocketClient("ws://tasks", () => {
      const socket = new TestSocket();
      sockets.push(socket);
      return socket;
    });
    client.subscribe((message) => received.push(message));

    client.connect();
    client.connect();
    expect(sockets[0]?.readyState).toBe(3);

    sockets[0]?.receive({ type: "connection.ready", connectionId: "stale" });
    sockets[1]?.receive({ type: "connection.ready", connectionId: "current" });

    expect(received).toEqual([{ type: "connection.ready", connectionId: "current" }]);
  });
});
