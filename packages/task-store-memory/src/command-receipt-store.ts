import {
  conflictError,
  type ActorContext,
  type CommandReceipt,
  type CommandReceiptStore,
  type SaveCommandReceiptInput,
} from '@voice-agent/contracts';

import { copy } from './state.js';

export class MemoryCommandReceiptStore implements CommandReceiptStore {
  private readonly receipts = new Map<string, CommandReceipt>();

  async get<Result>(
    context: ActorContext,
    commandId: string,
  ): Promise<CommandReceipt<Result> | null> {
    const receipt = this.receipts.get(this.key(context.actorId, commandId));
    return receipt ? copy(receipt as CommandReceipt<Result>) : null;
  }

  async save<Result>(
    context: ActorContext,
    input: SaveCommandReceiptInput<Result>,
  ): Promise<CommandReceipt<Result>> {
    const key = this.key(context.actorId, input.commandId);
    const existing = this.receipts.get(key);
    if (existing && existing.payloadFingerprint !== input.payloadFingerprint) {
      throw conflictError(`Command "${input.commandId}" was reused with a different payload.`);
    }
    if (existing) return copy(existing as CommandReceipt<Result>);

    const receipt: CommandReceipt<Result> = {
      actorId: context.actorId,
      ...copy(input),
    };
    this.receipts.set(key, receipt);
    return copy(receipt);
  }

  private key(actorId: string, commandId: string): string {
    return `${actorId}\0${commandId}`;
  }
}
