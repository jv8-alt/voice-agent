import {
  RealtimeAgent,
  RealtimeSession,
  type TransportEvent,
} from '@openai/agents-realtime';
import type { VoiceSessionMode, VoiceTranscriptEvent } from '@voice-agent/contracts';
import { z } from 'zod';
import type { VoiceRealtimeTransport } from './voice-session.js';

const transcriptDeltaSchema = z.object({
  type: z.literal('conversation.item.input_audio_transcription.delta'),
  item_id: z.string(),
  delta: z.string().optional(),
});

const transcriptCompletedSchema = z.object({
  type: z.literal('conversation.item.input_audio_transcription.completed'),
  item_id: z.string(),
  transcript: z.string(),
});

export interface RealtimeSessionClient {
  readonly transport: Pick<
    RealtimeSession['transport'],
    'requestResponse' | 'sendEvent' | 'updateSessionConfig'
  >;
  connect(options: { apiKey: string }): Promise<void>;
  close(): void;
  mute(muted: boolean): void;
  sendMessage(message: string): void;
  on(event: 'transport_event', listener: (event: TransportEvent) => void): unknown;
  on(event: 'audio_interrupted', listener: () => void): unknown;
}

export type RealtimeSessionFactory = () => RealtimeSessionClient;

function createRealtimeSession(): RealtimeSession {
  const agent = new RealtimeAgent({
    name: 'Voice outcome speaker',
    instructions: 'Render only the exact text requested by the application. Do not add commentary.',
  });
  return new RealtimeSession(agent, {
    transport: 'webrtc',
    config: {
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turnDetection: null,
        },
      },
    },
  });
}

/**
 * Owns the OpenAI SDK objects and translates their raw events into the small
 * provider-neutral transport surface consumed by OpenAIVoiceSession.
 */
export class OpenAIRealtimeTransport implements VoiceRealtimeTransport {
  private session: RealtimeSessionClient | null = null;
  private generation = 0;
  private readonly transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  private readonly interruptedListeners = new Set<() => void>();
  private readonly partialTranscripts = new Map<string, string>();

  constructor(private readonly sessionFactory: RealtimeSessionFactory = createRealtimeSession) {}

  async connect(clientSecret: string): Promise<void> {
    const generation = ++this.generation;
    const previous = this.session;
    this.session = null;
    previous?.close();
    this.partialTranscripts.clear();

    const session = this.sessionFactory();
    this.session = session;
    session.on('transport_event', (event) => {
      if (this.session === session) {
        this.handleTransportEvent(event);
      }
    });
    session.on('audio_interrupted', () => {
      if (this.session === session) {
        this.interruptedListeners.forEach((listener) => listener());
      }
    });

    try {
      await session.connect({ apiKey: clientSecret });
    } catch (error) {
      if (this.session === session) {
        this.session = null;
      }
      session.close();
      throw error;
    }
    if (generation !== this.generation || this.session !== session) {
      session.close();
    }
  }

  close(): void {
    this.generation += 1;
    const session = this.session;
    this.session = null;
    this.partialTranscripts.clear();
    session?.close();
  }

  setInputMuted(muted: boolean): void {
    this.requireSession().mute(muted);
  }

  setTurnMode(mode: VoiceSessionMode): void {
    this.requireSession().transport.updateSessionConfig({
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turnDetection:
            mode === 'handsfree'
              ? {
                  type: 'server_vad',
                  createResponse: false,
                  interruptResponse: true,
                  silenceDurationMs: 500,
                }
              : null,
        },
      },
    });
  }

  commitInput(): void {
    this.requireSession().transport.sendEvent({ type: 'input_audio_buffer.commit' });
  }

  speak(text: string): void {
    const session = this.requireSession();
    const response = {
      output_modalities: ['audio'],
      instructions: `Speak exactly this application outcome, with no additions: ${JSON.stringify(text)}`,
    };
    if (session.transport.requestResponse) {
      session.transport.requestResponse(response);
      return;
    }
    session.sendMessage(text);
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

  private handleTransportEvent(event: TransportEvent): void {
    const completed = transcriptCompletedSchema.safeParse(event);
    if (completed.success) {
      this.partialTranscripts.delete(completed.data.item_id);
      this.emitTranscript({ text: completed.data.transcript, final: true });
      return;
    }

    const delta = transcriptDeltaSchema.safeParse(event);
    if (!delta.success || !delta.data.delta) {
      return;
    }
    const text = (this.partialTranscripts.get(delta.data.item_id) ?? '') + delta.data.delta;
    this.partialTranscripts.set(delta.data.item_id, text);
    this.emitTranscript({ text, final: false });
  }

  private emitTranscript(event: VoiceTranscriptEvent): void {
    this.transcriptListeners.forEach((listener) => listener(event));
  }

  private requireSession(): RealtimeSessionClient {
    if (!this.session) {
      throw new Error('Realtime voice transport is not connected');
    }
    return this.session;
  }
}
