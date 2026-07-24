# Voice Coding Agent

Mobile-first voice interface for running coding-agent tasks against isolated
repositories. The demo is being built from the interaction reference in
`mock.html`; the implementation plan and current delivery graph live in
`MIKADO.md`.

## Current status

The demo is runnable end to end: Next.js submits voice or typed turns to
Fastify, follows resumable task events, and controls cancellation and approval.
Fastify composes process-local state, disposable fixture workspaces, Codex,
executive summaries, risk evaluation, and short-lived OpenAI Realtime sessions.

## Prerequisites

- Node.js 22 or newer
- pnpm
- A browser with microphone access
- An OpenAI API key with Codex, Agents, and Realtime access for live runs

## Set up the workspace

```sh
pnpm install
cp .env.example .env
```

Do not commit `.env`. `OPENAI_API_KEY` is a server-only secret and must never be
exposed through a `NEXT_PUBLIC_*` variable.

## Verify the repository

```sh
pnpm check
```

This runs lint, type checking, tests, and builds recursively for every workspace
package that implements the corresponding command.

The bundled coding fixture can also be checked directly:

```sh
pnpm --dir fixtures/demo-repo test
```

## Preview the approved UX mock

```sh
python3 -m http.server 4173
```

Open [http://localhost:4173/mock.html](http://localhost:4173/mock.html).

## Run the application

Set `OPENAI_API_KEY` in `.env`, keep `DEMO_REPO_ID=demo-repo`, then start both
applications with one command:

```sh
pnpm demo
```

Open [http://localhost:3000](http://localhost:3000). The local endpoints are:

- Web app: `http://localhost:3000`
- Task API: `http://localhost:3001`
- Task WebSocket: `ws://localhost:3001/ws`

The browser uses REST for task creation and snapshots, the Task WebSocket for
agent events, cancellation, and sensitive-action approval, and OpenAI Realtime
WebRTC for microphone input and spoken responses.

Microphone capture works on `localhost`. Any remote deployment must use HTTPS
(and `wss:` for the socket) or browsers will deny microphone access. Grant the
browser microphone prompt before starting push-to-talk or hands-free mode.

Final push-to-talk transcripts are submitted immediately on release; final
hands-free transcripts are submitted immediately after VAD silence. There is no
transcript review step in the shared voice contract.

## Demo environment

| Variable | Used by | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Task API only | OpenAI Realtime token minting, Codex, and executive summaries |
| `PORT` | Task API | Required Fastify port from `1` through `65535` |
| `WEB_ORIGIN` | Task API | Required exact HTTP(S) browser origin, such as `http://localhost:3000` |
| `DEMO_REPO_ID` | Task API | Opaque server-side workspace selector; use `demo-repo` |
| `NEXT_PUBLIC_TASK_API_URL` | Web (optional) | API origin; defaults to `http://localhost:3001` |

`workspaceId` stays server-side. No repository selector, fixture path, or
`fixtureId` is accepted from or returned to the browser.

## Golden demo

1. Run `pnpm demo` and open `http://localhost:3000`.
2. Hold **Push to talk**, request a small change to the greeting, then release.
   The final transcript submits immediately.
3. For a deterministic sensitive path, request a dependency install or broad
   delete; inspect the proposed action and approve or reject it.
4. Start another task and select **Cancel task** while it is working.
5. Return home to switch between process-local recent tasks.

The bundled fixture path is tested without live credentials:

```sh
pnpm --filter @voice-agent/task-api test -- fixture-e2e
```

That test edits a disposable `demo-repo` copy, runs its Node test, verifies the
task completes, and confirms the source fixture is unchanged.

## Adapter map

| Boundary | Demo implementation | Production replacement |
| --- | --- | --- |
| Task state/replay/receipts | `@voice-agent/task-store-memory` | Durable transactional database and event log |
| Workspace | `@voice-agent/workspace-fixture` | Auth-scoped remote sandbox/worktree provider |
| Coding agent | `@voice-agent/coding-agent-codex` | Same port with production sandbox policy |
| Executive output/risk | `@voice-agent/executive-openai` | Audited model gateway and organization policy |
| Browser voice | `@voice-agent/voice-openai` | Realtime provider behind `VoiceSession` |
| Authentication | Fixed `demo-user` | Request-derived actor identity and authorization |

## Demo limitations

- Task, command receipt, event, and active-run state is process-local and does
  not survive an API restart. Replay retains the latest 100 task events by
  default; older cursors require a fresh snapshot.
- Coding tasks run only in disposable copies of bundled fixture repositories.
- The initial `demo-repo` fixture is copied once per task. Lease release removes
  the copy; edits never change the source fixture or another task's workspace.
- Fixture IDs and task IDs are path-safe identifiers. Traversal and fixture
  symlinks are rejected so a lease cannot escape its configured roots.
- Workspace leases expose a local `rootPath` because the demo coding-agent
  adapter requires a directory. This is an intentional adapter seam, not a
  production sandbox guarantee.
- Codex first inspects each lease in an offline, read-only sandbox and returns
  normalized proposed actions. Approved runs and follow-ups resume that thread
  with workspace-write access, still without network access; cancellation is
  forwarded through the SDK's `AbortSignal`.
- Automated tests inject fake AI/voice edges and need no API key. `pnpm demo`
  uses the live Codex, OpenAI summary, and Realtime adapters.
- The browser client relies on server runtime schema validation and frozen DTO
  types; the frozen contracts runtime barrel imports Node crypto and is not
  browser-bundleable.
- Authentication is a fixed localhost demo identity.
- Typing is a basic fallback; push-to-talk and hands-free are the primary paths.

These constraints sit behind interfaces described in `MIKADO.md` so durable
storage, production authentication, and sandboxed remote repositories can
replace them without changing the browser contract.

## Contract package imports

Runtime code imports the production surface from `@voice-agent/contracts`.
Adapter tests import reusable suites from `@voice-agent/contracts/conformance`
and reference implementations from `@voice-agent/contracts/testing`; neither
test-only surface is re-exported by the production barrel.

## Runbook maintenance

Every change to setup, environment variables, ports, commands, fixtures, or
demo behavior must update this README in the same change. Instructions should
describe only commands that work at that point in the graph.
