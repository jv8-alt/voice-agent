import { runVoiceSessionConformance } from '@voice-agent/contracts/conformance';
import type { VoiceSessionMode, VoiceTranscriptEvent } from '@voice-agent/contracts';
import { describe, expect, it, vi } from 'vitest';
import { OpenAIVoiceSession, type VoiceRealtimeTransport } from './voice-session.js';

class FakeRealtimeTransport implements VoiceRealtimeTransport {
  readonly calls: string[] = [];
  readonly spoken: string[] = [];
  private readonly transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  private readonly interruptedListeners = new Set<() => void>();

  async connect(clientSecret: string): Promise<void> {
    this.calls.push(`connect:${clientSecret}`);
  }

  close(): void {
    this.calls.push('close');
  }

  setInputMuted(muted: boolean): void {
    this.calls.push(`mute:${muted}`);
  }

  setTurnMode(mode: VoiceSessionMode): void {
    this.calls.push(`mode:${mode}`);
  }

  commitInput(): void {
    this.calls.push('commit');
  }

  speak(text: string): void {
    this.spoken.push(text);
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

  emitTranscript(event: VoiceTranscriptEvent): void {
    this.transcriptListeners.forEach((listener) => listener(event));
  }

  emitInterrupted(): void {
    this.interruptedListeners.forEach((listener) => listener());
  }
}

runVoiceSessionConformance(() => {
  const transport = new FakeRealtimeTransport();
  return {
    session: new OpenAIVoiceSession(transport),
    emitTranscript: (event) => transport.emitTranscript(event),
    emitInterrupted: () => transport.emitInterrupted(),
  };
});

describe('OpenAIVoiceSession', () => {
  it('commits PTT audio immediately on release and delivers its final transcript', async () => {
    const transport = new FakeRealtimeTransport();
    const session = new OpenAIVoiceSession(transport);
    const listener = vi.fn();

    await session.connect({ clientSecret: 'ephemeral-secret' });
    session.onTranscript(listener);
    session.startTurn('ptt');
    session.stopTurn();
    transport.emitTranscript({ text: 'Fix checkout', final: true });

    expect(transport.calls).toEqual([
      'connect:ephemeral-secret',
      'mute:true',
      'mode:ptt',
      'mute:false',
      'mute:true',
      'commit',
    ]);
    expect(listener).toHaveBeenCalledWith({ text: 'Fix checkout', final: true });
  });

  it('lets server VAD finalize hands-free audio without a manual commit', async () => {
    const transport = new FakeRealtimeTransport();
    const session = new OpenAIVoiceSession(transport);
    const listener = vi.fn();

    await session.connect({ clientSecret: 'ephemeral-secret' });
    session.onTranscript(listener);
    session.startTurn('handsfree');
    transport.emitTranscript({ text: 'Run the tests', final: true });

    expect(transport.calls).toContain('mode:handsfree');
    expect(transport.calls).not.toContain('commit');
    expect(listener).toHaveBeenCalledWith({ text: 'Run the tests', final: true });
  });

  it('normalizes provider barge-in as an interruption callback', async () => {
    const transport = new FakeRealtimeTransport();
    const session = new OpenAIVoiceSession(transport);
    const listener = vi.fn();

    await session.connect({ clientSecret: 'ephemeral-secret' });
    session.onInterrupted(listener);
    transport.emitInterrupted();

    expect(listener).toHaveBeenCalledOnce();
  });

  it('delegates agent speech without exposing provider response objects', async () => {
    const transport = new FakeRealtimeTransport();
    const session = new OpenAIVoiceSession(transport);

    await session.connect({ clientSecret: 'ephemeral-secret' });
    await session.speak('All tests pass.');

    expect(transport.spoken).toEqual(['All tests pass.']);
  });

  it('drops provider callbacks after disconnect', async () => {
    const transport = new FakeRealtimeTransport();
    const session = new OpenAIVoiceSession(transport);
    const listener = vi.fn();

    await session.connect({ clientSecret: 'ephemeral-secret' });
    session.onTranscript(listener);
    await session.disconnect();
    transport.emitTranscript({ text: 'late raw callback', final: true });

    expect(listener).not.toHaveBeenCalled();
  });
});
