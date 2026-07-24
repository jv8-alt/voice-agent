import { conflictError } from '../../errors.js';
import type { ActorContext } from '../../ports/actor-context.js';
import type {
  CommandReceipt,
  CommandReceiptStore,
  SaveCommandReceiptInput,
} from '../../ports/command-receipt-store.js';

export class InMemoryFakeCommandReceiptStore implements CommandReceiptStore {
  private readonly receipts = new Map<string, CommandReceipt>();

  async get<Result>(context: ActorContext, commandId: string): Promise<CommandReceipt<Result> | null> {
    return (this.receipts.get(`${context.actorId}\0${commandId}`) as CommandReceipt<Result> | undefined) ?? null;
  }

  async save<Result>(
    context: ActorContext,
    input: SaveCommandReceiptInput<Result>,
  ): Promise<CommandReceipt<Result>> {
    const receipt: CommandReceipt<Result> = { actorId: context.actorId, ...input };
    const key = `${context.actorId}\0${receipt.commandId}`;
    const existing = this.receipts.get(key);
    if (existing && existing.payloadFingerprint !== receipt.payloadFingerprint) {
      throw conflictError(`Command "${receipt.commandId}" was reused with a different payload.`);
    }
    return (existing as CommandReceipt<Result> | undefined) ?? this.store(key, receipt);
  }

  private store<Result>(key: string, receipt: CommandReceipt<Result>): CommandReceipt<Result> {
    this.receipts.set(key, receipt);
    return receipt;
  }
}
