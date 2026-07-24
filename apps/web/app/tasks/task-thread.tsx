"use client";

import type {
  ApprovalRequest,
  SnapshotEnvelope,
  TurnMode,
  VoiceSession,
  VoiceSessionMode,
} from "@voice-agent/contracts";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";

type SubmitTurn = (input: { mode: TurnMode; text: string }) => void | Promise<void>;

export interface TaskThreadProps {
  envelope: SnapshotEnvelope;
  voice?: VoiceSession;
  onSubmit?: SubmitTurn;
  onCancel?: () => void;
  onResolveApproval?: (approval: ApprovalRequest, decision: "approve" | "reject") => void;
}

const statusLabel = {
  queued: "Queued",
  working: "Working",
  needs_input: "Needs your input",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

export function TaskThread({
  envelope,
  voice,
  onSubmit = () => {},
  onCancel = () => {},
  onResolveApproval = () => {},
}: TaskThreadProps) {
  const [mode, setMode] = useState<TurnMode>("ptt");
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  // Final transcripts can arrive after the composer mode changes; label the
  // turn with the mode that was active when capture started.
  const captureModeRef = useRef<VoiceSessionMode>("ptt");

  const beginVoiceCapture = (captureMode: VoiceSessionMode) => {
    captureModeRef.current = captureMode;
    voice?.startTurn(captureMode);
  };

  useEffect(() => voice?.onTranscript(({ final, text }) => {
    setPartial(final ? "" : text);
    if (final && text.trim()) {
      void onSubmit({ mode: captureModeRef.current, text: text.trim() });
    }
  }), [onSubmit, voice]);

  const approval = envelope.snapshot.pendingApproval;
  const latest = envelope.snapshot.turns.at(-1);

  return (
    <main className="thread-shell">
      <header className="thread-header">
        <Link className="icon-button" href="/" aria-label="Back to tasks">‹</Link>
        <div className="thread-heading">
          <p className="eyebrow">TASK</p>
          <h1>{envelope.snapshot.task.title}</h1>
        </div>
        <span className={`status ${envelope.snapshot.task.status}`}>
          {statusLabel[envelope.snapshot.task.status]}
        </span>
      </header>

      <section className="messages" aria-label="Task activity">
        {envelope.snapshot.turns.map((turn) => (
          <article className="user-message" key={turn.id}>{turn.text}</article>
        ))}
        {envelope.snapshot.updates.map((update) => (
          <article className={`agent-card ${update.phase}`} key={`${update.turnId}-${update.createdAt}`}>
            <strong>{update.headline}</strong>
            {update.detail && <p>{update.detail}</p>}
          </article>
        ))}
        {latest?.status === "working" &&
          !envelope.snapshot.updates.some(
            (update) => update.turnId === latest.id && update.phase === "working",
          ) && (
          <article className="agent-card working">
            <strong>Working on it</strong><div className="progress" />
          </article>
        )}
        {approval && (
          <article className="agent-card needs_input">
            <strong>I need your approval</strong>
            <p>{approval.reason}</p>
            <div className="approval-actions">
              <button onClick={() => onResolveApproval(approval, "reject")}>Reject</button>
              <button className="primary" onClick={() => onResolveApproval(approval, "approve")}>Approve</button>
            </div>
          </article>
        )}
      </section>

      <footer className="composer">
        {partial && <p className="live-transcript" aria-live="polite">{partial}</p>}
        {mode === "typing" ? (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) {
              void onSubmit({ mode: "typing", text: draft.trim() });
              setDraft("");
            }
          }}>
            <button type="button" onClick={() => setMode("ptt")} aria-label="Switch to voice">🎙</button>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a follow-up…" />
            <button className="primary" type="submit">Send</button>
          </form>
        ) : (
          <div className="voice-controls">
            <button
              onClick={() => {
                voice?.stopTurn();
                setMode("typing");
              }}
              aria-label="Switch to typing"
            >⌨</button>
            <button
              className="mic primary"
              onPointerDown={(event) => {
                if (mode !== "ptt") return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                beginVoiceCapture(mode);
              }}
              onPointerUp={() => { if (mode === "ptt") voice?.stopTurn(); }}
              onPointerCancel={() => { if (mode === "ptt") voice?.stopTurn(); }}
            >
              {mode === "handsfree" ? "Listening hands-free" : "Hold to talk"}
            </button>
            <button
              aria-pressed={mode === "handsfree"}
              onClick={() => {
                const next = mode === "handsfree" ? "ptt" : "handsfree";
                voice?.stopTurn();
                setMode(next);
                if (next === "handsfree") beginVoiceCapture(next);
              }}
            >∞</button>
          </div>
        )}
        {latest && ["queued", "working", "needs_input"].includes(latest.status) && (
          <button className="cancel" onClick={onCancel}>Cancel task</button>
        )}
      </footer>
    </main>
  );
}
