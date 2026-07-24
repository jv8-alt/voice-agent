import type {
  ClientMessage,
  CreateTaskRequest,
  CreateTaskResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  CreateVoiceClientSecretResponse,
  GetTaskResponse,
  GetTasksResponse,
  ServerMessage,
} from "@voice-agent/contracts";

type Fetch = typeof globalThis.fetch;

async function parsed<T>(response: Response): Promise<T> {
  const body = await response.json() as T;
  if (!response.ok) throw new Error(`Task API request failed (${response.status})`);
  return body;
}

export class TaskRestClient {
  constructor(private readonly baseUrl = "", private readonly request: Fetch = globalThis.fetch) {}

  list() {
    return this.request(`${this.baseUrl}/tasks`).then((response) => parsed<GetTasksResponse>(response));
  }

  get(taskId: string) {
    return this.request(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`)
      .then((response) => parsed<GetTaskResponse>(response));
  }

  create(input: CreateTaskRequest) {
    return this.request(`${this.baseUrl}/tasks`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }).then((response) => parsed<CreateTaskResponse>(response));
  }

  createTurn(taskId: string, input: CreateTurnRequest) {
    return this.request(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}/turns`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }).then((response) => parsed<CreateTurnResponse>(response));
  }

  createVoiceClientSecret() {
    return this.request(`${this.baseUrl}/voice/client-secret`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }).then((response) => parsed<CreateVoiceClientSecretResponse>(response));
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

  connect(): Promise<void> {
    this.close();
    const socket = this.createSocket(this.url);
    this.socket = socket;
    return new Promise((resolve) => {
      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        this.pending.forEach((command) => this.sendNow(command));
        resolve();
      });
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        const message = JSON.parse(String((event as MessageEvent).data)) as ServerMessage;
        if (message.type === "task.cancelled") this.pending.delete(message.commandId);
        if (message.type === "approval.resolved") this.pending.delete(message.commandId);
        this.listeners.forEach((listener) => listener(message));
      });
    });
  }

  subscribe(listener: (message: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(command: ClientMessage) {
    if ("commandId" in command) this.pending.set(command.commandId, command);
    this.sendNow(command);
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  private sendNow(command: ClientMessage) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(command));
  }
}
