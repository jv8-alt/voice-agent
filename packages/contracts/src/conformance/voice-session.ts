import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceSession, VoiceTranscriptEvent } from '../ports/voice-session.js';

export interface VoiceSessionConformanceDriver {
  readonly session: VoiceSession;
  emitTranscript(event: VoiceTranscriptEvent): void;
  emitInterrupted(): void;
}

/**
 * Conformance suite for the browser-side {@link VoiceSession} port.
 * Covers the lifecycle and subscription invariants the interface pins:
 * `connect()` must resolve before transcripts/interruption can be
 * observed, `onTranscript`/`onInterrupted` return working unsubscribe
 * functions, and `stopTurn()`/`disconnect()` are safe to call without a
 * prior matching call (defensive UI code will do this on unmount).
 */
export function runVoiceSessionConformance(
  createDriver: () => VoiceSessionConformanceDriver | Promise<VoiceSessionConformanceDriver>,
): void {
  describe('VoiceSession conformance', () => {
    let driver: VoiceSessionConformanceDriver;
    let session: VoiceSession;

    beforeEach(async () => {
      driver = await createDriver();
      session = driver.session;
    });

    it('connects without throwing given a client secret', async () => {
      await expect(session.connect({ clientSecret: 'secret-123' })).resolves.toBeUndefined();
    });

    it('disconnect() is safe to call without a prior connect()', async () => {
      await expect(session.disconnect()).resolves.toBeUndefined();
    });

    it('stopTurn() is safe to call without a prior startTurn()', async () => {
      expect(() => session.stopTurn()).not.toThrow();
    });

    it('onTranscript() returns an idempotent, callable unsubscribe function', async () => {
      await session.connect({ clientSecret: 'secret-123' });
      const unsubscribe = session.onTranscript(vi.fn());
      expect(() => unsubscribe()).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
    });

    it('onInterrupted() returns a callable unsubscribe function', async () => {
      await session.connect({ clientSecret: 'secret-123' });
      const unsubscribe = session.onInterrupted(() => {});
      expect(() => unsubscribe()).not.toThrow();
    });

    it('speak() resolves for a non-empty string', async () => {
      await session.connect({ clientSecret: 'secret-123' });
      await expect(session.speak('All done.')).resolves.toBeUndefined();
    });

    it('delivers the final PTT transcript after release for immediate submission', async () => {
      await session.connect({ clientSecret: 'secret-123' });
      const listener = vi.fn();
      session.onTranscript(listener);
      session.startTurn('ptt');
      session.stopTurn();
      driver.emitTranscript({ text: 'Fix checkout', final: true });
      expect(listener).toHaveBeenCalledWith({ text: 'Fix checkout', final: true });
    });

    it('delivers a final hands-free transcript on VAD completion without stopTurn()', async () => {
      await session.connect({ clientSecret: 'secret-123' });
      const listener = vi.fn();
      session.onTranscript(listener);
      session.startTurn('handsfree');
      driver.emitTranscript({ text: 'Run the tests', final: true });
      expect(listener).toHaveBeenCalledWith({ text: 'Run the tests', final: true });
    });

    it('notifies subscribers when speech interrupts playback', async () => {
      await session.connect({ clientSecret: 'secret-123' });
      const listener = vi.fn();
      session.onInterrupted(listener);
      driver.emitInterrupted();
      expect(listener).toHaveBeenCalledOnce();
    });
  });
}
