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

/**
 * Owns the OpenAI SDK objects and translates their raw events into the small
 * provider-neutral transport surface consumed by OpenAIVoiceSession.
 */
export class OpenAIRealtimeTransport implements VoiceRealtimeTransport {
  private readonly session: RealtimeSession;
  private readonly transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  private readonly interruptedListeners = new Set<() => void>();
  private readonly partialTranscripts = new Map<string, string>();

  constructor() {
    const agent = new RealtimeAgent({
      name: 'Voice outcome speaker',
      instructions: 'Render only the exact text requested by the application. Do not add commentary.',
    });
    this.session = new RealtimeSession(agent, {
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
    this.session.on('transport_event', (event) => this.handleTransportEvent(event));
    this.session.on('audio_interrupted', () => {
      this.interruptedListeners.forEach((listener) => listener());
    });
  }

  async connect(clientSecret: string): Promise<void> {
    await this.session.connect({ apiKey: clientSecret });
  }

  close(): void {
    this.partialTranscripts.clear();
    this.session.close();
  }

  setInputMuted(muted: boolean): void {
    this.session.mute(muted);
  }

  setTurnMode(mode: VoiceSessionMode): void {
    this.session.transport.updateSessionConfig({
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
    this.session.transport.sendEvent({ type: 'input_audio_buffer.commit' });
  }

  speak(text: string): void {
    const response = {
      output_modalities: ['audio'],
      instructions: `Speak exactly this application outcome, with no additions: ${JSON.stringify(text)}`,
    };
    if (this.session.transport.requestResponse) {
      this.session.transport.requestResponse(response);
      return;
    }
    this.session.sendMessage(text);
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
}
