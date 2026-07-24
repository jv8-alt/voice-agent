# Voice Coding Agent

Mobile-first voice interface for running coding-agent tasks against isolated
repositories. The demo is being built from the interaction reference in
`mock.html`; the implementation plan and current delivery graph live in
`MIKADO.md`.

## Current status

The repository currently contains the workspace foundation, interactive HTML
mock, shared `@voice-agent/contracts` package, and the injectable Fastify
application shell. Task routes, WebSocket orchestration, Next.js, OpenAI voice,
and Codex adapters will be added by the nodes listed in `MIKADO.md`.

## Prerequisites

- Node.js 22 or newer
- pnpm
- Python 3 only if previewing the standalone HTML mock

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

## Preview the approved UX mock

```sh
python3 -m http.server 4173
```

Open [http://localhost:4173/mock.html](http://localhost:4173/mock.html).

## Run the application

The Fastify shell is available for injection tests but has no task routes or
standalone startup entry point until F2. Once the runnable applications land,
the canonical command will be:

```sh
pnpm dev
```

The intended local endpoints are:

- Web app: `http://localhost:3000`
- Task API: `http://localhost:3001`
- Task WebSocket: `ws://localhost:3001/ws`

The browser uses REST for task creation and snapshots, the Task WebSocket for
agent events, cancellation, and sensitive-action approval, and OpenAI Realtime
WebRTC for microphone input and spoken responses.

Final push-to-talk transcripts are submitted immediately on release; final
hands-free transcripts are submitted immediately after VAD silence. There is no
transcript review step in the shared voice contract.

## Demo environment

| Variable | Used by | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Task API only | OpenAI Realtime token minting, Codex, and executive summaries |
| `PORT` | Task API | Required Fastify port from `1` through `65535` |
| `WEB_ORIGIN` | Task API | Required exact HTTP(S) browser origin, such as `http://localhost:3000` |
| `DEMO_REPO_ID` | Task API | Local fixture repository selected for new tasks |

## Demo limitations

- Task and event state will initially be process-local and will not survive an
  API restart.
- Coding tasks run only in disposable copies of bundled fixture repositories.
- Workspace leases expose a local `rootPath` because the demo coding-agent
  adapter requires a directory. This is an intentional adapter seam, not a
  production sandbox guarantee.
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
