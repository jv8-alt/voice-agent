import type {
  ConnectVoiceSessionInput,
  VoiceSession,
  VoiceSessionMode,
  VoiceTranscriptEvent,
} from '@voice-agent/contracts';
import { OpenAIRealtimeTransport } from './openai-realtime-transport.js';

/**
 * Provider-neutral seam used to test voice behavior without WebRTC, microphone
 * access, or provider credentials. Provider events are normalized before they
 * cross this boundary.
 */
export interface VoiceRealtimeTransport {
  connect(clientSecret: string): Promise<void>;
  close(): void;
  setInputMuted(muted: boolean): void;
  setTurnMode(mode: VoiceSessionMode): void;
  commitInput(): void;
  speak(text: string): void;
  onTranscript(listener: (event: VoiceTranscriptEvent) => void): () => void;
  onInterrupted(listener: () => void): () => void;
}

export class OpenAIVoiceSession implements VoiceSession {
  private connected = false;
  private activeMode: VoiceSessionMode | null = null;
  private readonly transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  private readonly interruptedListeners = new Set<() => void>();

  constructor(private readonly transport: VoiceRealtimeTransport = new OpenAIRealtimeTransport()) {
    transport.onTranscript((event) => {
      if (this.connected) {
        this.transcriptListeners.forEach((listener) => listener(event));
      }
    });
    transport.onInterrupted(() => {
      if (this.connected) {
        this.interruptedListeners.forEach((listener) => listener());
      }
    });
  }

  async connect(input: ConnectVoiceSessionInput): Promise<void> {
    await this.transport.connect(input.clientSecret);
    this.connected = true;
    this.transport.setInputMuted(true);
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.transport.close();
    }
    this.connected = false;
    this.activeMode = null;
  }

  startTurn(mode: VoiceSessionMode): void {
    this.activeMode = mode;
    this.transport.setTurnMode(mode);
    this.transport.setInputMuted(false);
  }

  stopTurn(): void {
    if (this.activeMode !== 'ptt') {
      return;
    }
    this.transport.setInputMuted(true);
    this.transport.commitInput();
    this.activeMode = null;
  }

  async speak(text: string): Promise<void> {
    this.transport.speak(text);
  }

  onTranscript(listener: (event: VoiceTranscriptEvent) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => {
      this.transcriptListeners.delete(listener);
    };
  }

  onInterrupted(listener: () => void): () => void {
    this.interruptedListeners.add(listener);
    return () => {
      this.interruptedListeners.delete(listener);
    };
  }
}
