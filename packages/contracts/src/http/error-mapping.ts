import type { TaskErrorCode } from '../errors.js';

/* This file lives in `http/` (not a sibling `errors/` folder) to avoid a
 * naming collision with the domain-level `../errors.ts`; it purely maps
 * that module's `TaskErrorCode` onto transport-specific HTTP statuses. */

/**
 * Pins the HTTP status for each {@link TaskErrorCode}, per MIKADO.md's
 * design decisions ("Contracts pin 400 invalid input, 404 missing
 * task/workspace, 409 active turn or invalid state, 422 unsupported
 * fixture, 503 unavailable dependency, and 500 internal error."). T2
 * deliberately left this mapping out of the domain vocabulary; it is T3's
 * job because it is transport-specific.
 *
 * Declared as a `Record<TaskErrorCode, number>` (not a `switch`) so that
 * adding a new `TaskErrorCode` in a future contract revision is a
 * compile error here until this map is updated, rather than a silent
 * fallthrough.
 */
const TASK_ERROR_HTTP_STATUS = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  unsupported_fixture: 422,
  dependency_unavailable: 503,
  internal: 500,
} as const satisfies Record<TaskErrorCode, number>;

export function mapTaskErrorCodeToHttpStatus(code: TaskErrorCode): number {
  return TASK_ERROR_HTTP_STATUS[code];
}

/**
 * Which pinned `TaskErrorCode`s (and therefore which HTTP statuses, via
 * {@link mapTaskErrorCodeToHttpStatus}) each REST endpoint may return.
 * Every endpoint may also fail with `internal` (500); it is listed
 * explicitly below for completeness rather than assumed implicitly, and
 * the OpenAPI generator (`../openapi/generate.ts`) reads this map to
 * attach the right error response schemas to each path.
 */
export const TASK_ENDPOINT_ERROR_CODES = {
  'GET /tasks': ['internal'],
  'POST /tasks': ['invalid_input', 'unsupported_fixture', 'internal'],
  'GET /tasks/{taskId}': ['not_found', 'internal'],
  'POST /tasks/{taskId}/turns': ['invalid_input', 'not_found', 'conflict', 'internal'],
  'GET /tasks/{taskId}/events': ['invalid_input', 'not_found', 'internal'],
  'POST /voice/client-secret': ['dependency_unavailable', 'internal'],
} as const satisfies Record<string, readonly TaskErrorCode[]>;
export type TaskEndpointKey = keyof typeof TASK_ENDPOINT_ERROR_CODES;
