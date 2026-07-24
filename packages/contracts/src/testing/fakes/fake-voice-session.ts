import type {
  ConnectVoiceSessionInput,
  VoiceSession,
  VoiceSessionMode,
  VoiceTranscriptEvent,
} from '../../ports/voice-session.js';

/**
 * Reference {@link VoiceSession} implementation. No real audio or
 * WebRTC transport: `emitTranscript()`/`emitInterrupted()` let a test
 * drive the subscription surface manually. North star for D1's real
 * OpenAI Realtime adapter.
 */
export class FakeVoiceSession implements VoiceSession {
  private connected = false;
  private activeMode: VoiceSessionMode | null = null;
  private readonly transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  private readonly interruptedListeners = new Set<() => void>();

  async connect(_input: ConnectVoiceSessionInput): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.activeMode = null;
  }

  startTurn(mode: VoiceSessionMode): void {
    this.activeMode = mode;
  }

  stopTurn(): void {
    this.activeMode = null;
  }

  async speak(_text: string): Promise<void> {
    // No-op: this fake never produces real audio.
  }

  onTranscript(listener: (event: VoiceTranscriptEvent) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  onInterrupted(listener: () => void): () => void {
    this.interruptedListeners.add(listener);
    return () => this.interruptedListeners.delete(listener);
  }

  /** Test-only helper: simulates a partial/final transcript arriving from the realtime connection. */
  emitTranscript(event: VoiceTranscriptEvent): void {
    for (const listener of this.transcriptListeners) listener(event);
  }

  /** Test-only helper: simulates the user barging in on a spoken response. */
  emitInterrupted(): void {
    for (const listener of this.interruptedListeners) listener();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get currentMode(): VoiceSessionMode | null {
    return this.activeMode;
  }
}
