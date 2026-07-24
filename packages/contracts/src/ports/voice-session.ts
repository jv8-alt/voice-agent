export type VoiceSessionMode = 'ptt' | 'handsfree';

export interface VoiceTranscriptEvent {
  readonly text: string;
  readonly final: boolean;
}

export interface ConnectVoiceSessionInput {
  /** Short-lived client secret minted by `POST /voice/client-secret`; the long-lived API key never reaches the browser. */
  readonly clientSecret: string;
}

/**
 * Browser-side wrapper around a realtime voice connection. Push-to-talk
 * commits manually via `stopTurn()`; hands-free relies on VAD but the
 * resulting transcript is still reviewed before being submitted as a task
 * or turn, per MIKADO.md's voice design decision.
 *
 * Demo adapter: OpenAI Realtime over WebRTC via the OpenAI Agents SDK
 * (`packages/voice-openai`). Production adapter: the same or a different
 * realtime voice provider behind this interface.
 */
export interface VoiceSession {
  connect(input: ConnectVoiceSessionInput): Promise<void>;
  disconnect(): Promise<void>;

  /** Begins capturing a turn in the given mode. */
  startTurn(mode: VoiceSessionMode): void;

  /** Manually commits the current turn (required for `ptt`; a no-op for `handsfree`, which commits on VAD silence). */
  stopTurn(): void;

  /** Speaks a final text outcome back to the user. */
  speak(text: string): Promise<void>;

  /** Subscribes to partial and final transcripts; returns an unsubscribe function. */
  onTranscript(listener: (event: VoiceTranscriptEvent) => void): () => void;

  /** Subscribes to user-barge-in interruption of an in-progress spoken response; returns an unsubscribe function. */
  onInterrupted(listener: () => void): () => void;
}
