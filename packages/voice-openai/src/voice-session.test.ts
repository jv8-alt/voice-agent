import { runVoiceSessionConformance } from '@voice-agent/contracts/conformance';
import type { VoiceSessionMode, VoiceTranscriptEvent } from '@voice-agent/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenAIRealtimeTransport,
  type RealtimeSessionClient,
} from './openai-realtime-transport.js';
import { OpenAIVoiceSession, type VoiceRealtimeTransport } from './voice-session.js';

class FakeRealtimeTransport implements VoiceRealtimeTransport {
  readonly calls: string[] = [];
  readonly spoken: string[] = [];
  connectGate: Promise<void> | undefined;
  onClose: (() => void) | undefined;
  private readonly transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  private readonly interruptedListeners = new Set<() => void>();

  async connect(clientSecret: string): Promise<void> {
    this.calls.push(`connect:${clientSecret}`);
    await this.connectGate;
  }

  close(): void {
    this.calls.push('close');
    this.onClose?.();
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class FakeSdkRealtimeSession implements RealtimeSessionClient {
  readonly transport = {
    requestResponse: vi.fn(),
    sendEvent: vi.fn(),
    updateSessionConfig: vi.fn(),
  };
  readonly connect = vi.fn(async (options: { apiKey: string }) => {
    void options;
  });
  readonly close = vi.fn();
  readonly mute = vi.fn();
  readonly sendMessage = vi.fn();

  on(event: 'transport_event', listener: (event: never) => void): unknown;
  on(event: 'audio_interrupted', listener: () => void): unknown;
  on(event: 'transport_event' | 'audio_interrupted', listener: ((event: never) => void) | (() => void)) {
    void event;
    void listener;
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

  it('stays disconnected when teardown wins an in-flight connect race', async () => {
    const transport = new FakeRealtimeTransport();
    const gate = deferred();
    transport.connectGate = gate.promise;
    const session = new OpenAIVoiceSession(transport);
    const listener = vi.fn();
    session.onTranscript(listener);

    const connecting = session.connect({ clientSecret: 'ephemeral-secret' });
    await session.disconnect();
    gate.resolve();
    await connecting;
    transport.emitTranscript({ text: 'late connection', final: true });

    expect(transport.calls).toEqual(['connect:ephemeral-secret', 'close']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('suppresses transcript and interruption events emitted synchronously by close', async () => {
    const transport = new FakeRealtimeTransport();
    const session = new OpenAIVoiceSession(transport);
    const transcriptListener = vi.fn();
    const interruptionListener = vi.fn();
    session.onTranscript(transcriptListener);
    session.onInterrupted(interruptionListener);
    transport.onClose = () => {
      transport.emitTranscript({ text: 'closing event', final: true });
      transport.emitInterrupted();
    };

    await session.connect({ clientSecret: 'ephemeral-secret' });
    await session.disconnect();

    expect(transcriptListener).not.toHaveBeenCalled();
    expect(interruptionListener).not.toHaveBeenCalled();
  });
});

describe('OpenAIRealtimeTransport lifecycle', () => {
  it('creates a fresh SDK session when reconnecting after close', async () => {
    const first = new FakeSdkRealtimeSession();
    const second = new FakeSdkRealtimeSession();
    const sessions = [first, second];
    const transport = new OpenAIRealtimeTransport(() => {
      const session = sessions.shift();
      if (!session) {
        throw new Error('Unexpected SDK session request');
      }
      return session;
    });

    await transport.connect('first-secret');
    transport.close();
    await transport.connect('second-secret');

    expect(first.connect).toHaveBeenCalledWith({ apiKey: 'first-secret' });
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.connect).toHaveBeenCalledWith({ apiKey: 'second-secret' });
    expect(second.close).not.toHaveBeenCalled();
  });
});
