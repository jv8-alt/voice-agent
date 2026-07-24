/**
 * In-package fake implementations of all eight T2 ports.
 *
 * Design choice (T3): these are exported only from the `@voice-agent/contracts/testing`
 * subpath (see `package.json`'s `exports` map), never from the main `.`
 * barrel (`../../index.ts`). They exist to (1) prove each conformance
 * suite under `../../conformance/` is itself correct, by running it
 * against these fakes in this package's own test files, and (2) serve as
 * a reference implementation for later branch agents (B2, C1/C2, D1, E1)
 * — they are deliberately named `*Fake*` / `InMemoryFake*` so nobody
 * mistakes them for production or demo adapters.
 */
export { FakeActionRiskEvaluator } from './fake-action-risk-evaluator.js';
export { InMemoryFakeCommandReceiptStore } from './in-memory-command-receipt-store.js';
export { FakeCodingAgent } from './fake-coding-agent.js';
export type { FakeCodingAgentScenario } from './fake-coding-agent.js';
export { FakeExecutivePresenter } from './fake-executive-presenter.js';
export { FakeVoiceSession } from './fake-voice-session.js';
export { InMemoryFakeTaskEventLog } from './in-memory-task-event-log.js';
export { InMemoryFakeTaskRunRegistry } from './in-memory-task-run-registry.js';
export { InMemoryFakeTaskStore } from './in-memory-task-store.js';
export { InMemoryFakeWorkspaceProvider } from './in-memory-workspace-provider.js';
