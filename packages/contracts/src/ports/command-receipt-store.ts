import type { ActorContext } from './actor-context.js';

export interface CommandReceipt<Result = unknown> {
  readonly actorId: string;
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly result: Result;
  readonly createdAt: string;
}

export type SaveCommandReceiptInput<Result = unknown> = Omit<CommandReceipt<Result>, 'actorId'>;

/**
 * Durable idempotency boundary. Implementations return an existing receipt
 * for the same actor/command and reject a changed fingerprint as `conflict`.
 */
export interface CommandReceiptStore {
  get<Result = unknown>(context: ActorContext, commandId: string): Promise<CommandReceipt<Result> | null>;
  save<Result = unknown>(
    context: ActorContext,
    receipt: SaveCommandReceiptInput<Result>,
  ): Promise<CommandReceipt<Result>>;
}
