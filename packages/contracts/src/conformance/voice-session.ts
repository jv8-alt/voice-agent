import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceSession } from '../ports/voice-session.js';

/**
 * Conformance suite for the browser-side {@link VoiceSession} port.
 * Covers the lifecycle and subscription invariants the interface pins:
 * `connect()` must resolve before transcripts/interruption can be
 * observed, `onTranscript`/`onInterrupted` return working unsubscribe
 * functions, and `stopTurn()`/`disconnect()` are safe to call without a
 * prior matching call (defensive UI code will do this on unmount).
 */
export function runVoiceSessionConformance(
  createSession: () => VoiceSession | Promise<VoiceSession>,
): void {
  describe('VoiceSession conformance', () => {
    let session: VoiceSession;

    beforeEach(async () => {
      session = await createSession();
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
  });
}
