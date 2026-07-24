# Voice Coding Agent

Mobile-first voice interface for running coding-agent tasks against isolated
repositories. The demo is being built from the interaction reference in
`mock.html`; the implementation plan and current delivery graph live in
`MIKADO.md`.

## Current status

The repository currently contains the workspace foundation and interactive HTML
mock. Next.js, Fastify, WebSocket orchestration, OpenAI voice, and Codex adapters
will be added by the nodes listed in `MIKADO.md`.

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

The runnable Next.js and Fastify applications have not landed yet. Once their
Mikado nodes are complete, the canonical command will be:

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

## Demo environment

| Variable | Used by | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Task API only | OpenAI Realtime token minting, Codex, and executive summaries |
| `PORT` | Task API | Fastify port; defaults to `3001` |
| `WEB_ORIGIN` | Task API | Allowed browser origin; defaults to `http://localhost:3000` |
| `DEMO_REPO_ID` | Task API | Local fixture repository selected for new tasks |

## Demo limitations

- Task and event state will initially be process-local and will not survive an
  API restart.
- Coding tasks run only in disposable copies of bundled fixture repositories.
- Authentication is a fixed localhost demo identity.
- Typing is a basic fallback; push-to-talk and hands-free are the primary paths.

These constraints sit behind interfaces described in `MIKADO.md` so durable
storage, production authentication, and sandboxed remote repositories can
replace them without changing the browser contract.

## Runbook maintenance

Every change to setup, environment variables, ports, commands, fixtures, or
demo behavior must update this README in the same change. Instructions should
describe only commands that work at that point in the graph.
