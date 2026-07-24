import {
  ClientMessageSchema,
  CreateTaskResponseSchema,
  CreateTurnResponseSchema,
  GetTaskResponseSchema,
  GetTasksResponseSchema,
  ServerMessageSchema,
  type ClientMessage,
  type CreateTaskRequest,
  type CreateTurnRequest,
  type ServerMessage,
} from "@voice-agent/contracts";

type Fetch = typeof globalThis.fetch;

async function parsed<T>(response: Response, schema: { parse(value: unknown): T }): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`Task API request failed (${response.status})`);
  return schema.parse(body);
}

export class TaskRestClient {
  constructor(private readonly baseUrl = "", private readonly request: Fetch = globalThis.fetch) {}

  list() {
    return this.request(`${this.baseUrl}/tasks`).then((response) => parsed(response, GetTasksResponseSchema));
  }

  get(taskId: string) {
    return this.request(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`)
      .then((response) => parsed(response, GetTaskResponseSchema));
  }

  create(input: CreateTaskRequest) {
    return this.request(`${this.baseUrl}/tasks`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }).then((response) => parsed(response, CreateTaskResponseSchema));
  }

  createTurn(taskId: string, input: CreateTurnRequest) {
    return this.request(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}/turns`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }).then((response) => parsed(response, CreateTurnResponseSchema));
  }
}

interface SocketLike {
  readyState: number;
  send(data: string): void;
  addEventListener(type: "open" | "message", listener: (event: Event | MessageEvent) => void): void;
  close(): void;
}

export class TaskSocketClient {
  private socket: SocketLike | null = null;
  private readonly pending = new Map<string, ClientMessage>();
  private readonly listeners = new Set<(message: ServerMessage) => void>();

  constructor(
    private readonly url: string,
    private readonly createSocket: (url: string) => SocketLike =
      (socketUrl) => new WebSocket(socketUrl),
  ) {}

  connect() {
    this.socket = this.createSocket(this.url);
    this.socket.addEventListener("open", () => {
      this.pending.forEach((command) => this.sendNow(command));
    });
    this.socket.addEventListener("message", (event) => {
      const message = ServerMessageSchema.parse(JSON.parse(String((event as MessageEvent).data)));
      if (message.type === "task.cancelled") this.pending.delete(message.commandId);
      if (message.type === "approval.resolved") this.pending.delete(message.commandId);
      this.listeners.forEach((listener) => listener(message));
    });
  }

  subscribe(listener: (message: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(command: ClientMessage) {
    const checked = ClientMessageSchema.parse(command);
    if ("commandId" in checked) this.pending.set(checked.commandId, checked);
    this.sendNow(checked);
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  private sendNow(command: ClientMessage) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(command));
  }
}
