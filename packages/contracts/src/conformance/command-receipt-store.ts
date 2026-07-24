import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandReceiptStore } from '../ports/command-receipt-store.js';

export function runCommandReceiptStoreConformance(
  createStore: () => CommandReceiptStore | Promise<CommandReceiptStore>,
): void {
  describe('CommandReceiptStore conformance', () => {
    let store: CommandReceiptStore;
    const actor = { actorId: 'actor-1' };
    const receipt = {
      commandId: 'command-1',
      payloadFingerprint: 'sha256:same',
      result: { cancelled: true },
      createdAt: '2026-07-24T18:00:00.000Z',
    };

    beforeEach(async () => {
      store = await createStore();
    });

    it('returns the original result for the same actor, ID, and payload', async () => {
      const original = await store.save(actor, receipt);
      expect(await store.save(actor, { ...receipt, result: { cancelled: false } })).toEqual(original);
    });

    it('rejects the same ID with a changed payload and isolates actors', async () => {
      await store.save(actor, receipt);
      await expect(store.save(actor, { ...receipt, payloadFingerprint: 'sha256:different' })).rejects.toMatchObject({
        code: 'conflict',
      });
      await expect(store.get({ actorId: 'actor-2' }, receipt.commandId)).resolves.toBeNull();
    });
  });
}
