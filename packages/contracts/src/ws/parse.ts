import { invalidInputError } from '../errors.js';
import type { TaskError } from '../errors.js';
import { ClientMessageSchema, type ClientMessage } from './client-messages.js';
import { ServerMessageSchema, type ServerMessage } from './server-messages.js';

export type ParseMessageResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TaskError };

function safeIssues(error: { issues: readonly { path: readonly (string | number)[]; message: string }[] }) {
  return { issues: error.issues.map(({ path, message }) => `${path.join('.') || '<root>'}: ${message}`) };
}

/**
 * Parses raw (already-JSON-decoded) WebSocket input as a {@link ServerMessage}.
 * Never throws: malformed input returns `{ ok: false }` with an
 * `invalid_input` {@link TaskError} carrying the Zod issues as `details`,
 * so callers can log or surface the pinned error shape instead of an
 * uncaught exception (the "malformed message rejection" contract
 * invariant).
 */
export function parseServerMessage(input: unknown): ParseMessageResult<ServerMessage> {
  const result = ServerMessageSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    error: invalidInputError('Malformed server message.', { details: safeIssues(result.error) }),
  };
}

/** Client-message counterpart of {@link parseServerMessage}. */
export function parseClientMessage(input: unknown): ParseMessageResult<ClientMessage> {
  const result = ClientMessageSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    error: invalidInputError('Malformed client message.', { details: safeIssues(result.error) }),
  };
}
