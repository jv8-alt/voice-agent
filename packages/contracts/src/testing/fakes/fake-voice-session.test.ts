import { describe, expect, it, vi } from 'vitest';
import { runVoiceSessionConformance } from '../../conformance/voice-session.js';
import { FakeVoiceSession } from './fake-voice-session.js';

runVoiceSessionConformance(() => {
  const session = new FakeVoiceSession();
  return {
    session,
    emitTranscript: (event) => session.emitTranscript(event),
    emitInterrupted: () => session.emitInterrupted(),
  };
});

describe('FakeVoiceSession (extra emission helpers)', () => {
  it('emitTranscript() delivers to subscribed listeners until unsubscribed', async () => {
    const session = new FakeVoiceSession();
    await session.connect({ clientSecret: 'secret-123' });
    const listener = vi.fn();
    const unsubscribe = session.onTranscript(listener);

    session.emitTranscript({ text: 'fix the bug', final: false });
    expect(listener).toHaveBeenCalledWith({ text: 'fix the bug', final: false });

    unsubscribe();
    session.emitTranscript({ text: 'fix the bug please', final: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emitInterrupted() delivers to subscribed listeners', async () => {
    const session = new FakeVoiceSession();
    await session.connect({ clientSecret: 'secret-123' });
    const listener = vi.fn();
    session.onInterrupted(listener);

    session.emitInterrupted();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tracks connection and turn-mode state', () => {
    const session = new FakeVoiceSession();
    expect(session.isConnected).toBe(false);
    session.startTurn('handsfree');
    expect(session.currentMode).toBe('handsfree');
    session.stopTurn();
    expect(session.currentMode).toBeNull();
  });
});
