export {
  ApprovalRequestSchema,
  CodingEventSchema,
  ExecutiveUpdatePhaseSchema,
  ExecutiveUpdateSchema,
  ProposedActionSchema,
  TaskSchema,
  TaskSnapshotSchema,
  TechnicalSummarySchema,
  TurnModeSchema,
  TurnSchema,
} from './domain.js';
export type {
  ApprovalRequest,
  CodingEvent,
  ExecutiveUpdate,
  ExecutiveUpdatePhase,
  ProposedAction,
  Task,
  TaskSnapshot,
  TechnicalSummary,
  Turn,
  TurnMode,
} from './domain.js';

export {
  TaskError,
  TaskErrorCodeSchema,
  TaskErrorProblemSchema,
  conflictError,
  dependencyUnavailableError,
  internalError,
  invalidInputError,
  missingResourceError,
  unsupportedFixtureError,
} from './errors.js';
export type { TaskErrorCode, TaskErrorOptions, TaskErrorProblem } from './errors.js';

export {
  TaskStatusSchema,
  canTransitionTaskStatus,
  isActiveTaskStatus,
  transitionTaskStatus,
} from './status.js';
export type { TaskStatus, TransitionTaskStatusOptions } from './status.js';

export * from './ports/index.js';
