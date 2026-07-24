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
  initialMode?: TurnMode;
  /** Request microphone permission and connect voice before capture. */
  ensureVoice?: () => Promise<boolean>;
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
  initialMode = "ptt",
  ensureVoice,
  onSubmit = () => {},
  onCancel = () => {},
  onResolveApproval = () => {},
}: TaskThreadProps) {
  const [mode, setMode] = useState<TurnMode>(initialMode);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [pttHeld, setPttHeld] = useState(false);
  // Final transcripts can arrive after the composer mode changes; label the
  // turn with the mode that was active when capture started.
  const captureModeRef = useRef<VoiceSessionMode>("ptt");
  const captureAttemptRef = useRef(0);
  const pttHeldRef = useRef(false);
  const pttCapturingRef = useRef(false);

  const beginVoiceCapture = (captureMode: VoiceSessionMode) => {
    captureModeRef.current = captureMode;
    const attempt = ++captureAttemptRef.current;
    const start = () => {
      if (captureAttemptRef.current !== attempt) return;
      if (captureMode === "ptt" && !pttHeldRef.current) return;
      voice?.startTurn(captureMode);
      if (captureMode === "ptt") pttCapturingRef.current = true;
    };
    if (!ensureVoice) {
      start();
      return;
    }
    void ensureVoice().then((ready) => {
      if (ready) start();
    });
  };

  const endPushToTalk = () => {
    pttHeldRef.current = false;
    setPttHeld(false);
    captureAttemptRef.current += 1;
    if (!pttCapturingRef.current) return;
    pttCapturingRef.current = false;
    voice?.stopTurn();
  };

  useEffect(() => voice?.onTranscript(({ final, text }) => {
    setPartial(final ? "" : text);
    if (final && text.trim()) {
      void onSubmit({ mode: captureModeRef.current, text: text.trim() });
    }
  }), [onSubmit, voice]);

  const approval = envelope.snapshot.pendingApproval;
  const latest = envelope.snapshot.turns.at(-1);
  const turnIds = new Set(envelope.snapshot.turns.map(({ id }) => id));

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
          <React.Fragment key={turn.id}>
            <article className="user-message">{turn.text}</article>
            {envelope.snapshot.updates
              .filter((update) => update.turnId === turn.id)
              .map((update) => (
                <article
                  className={`agent-card ${update.phase}`}
                  key={`${update.turnId}-${update.createdAt}`}
                >
                  <strong>{update.headline}</strong>
                  {update.detail && <p>{update.detail}</p>}
                </article>
              ))}
          </React.Fragment>
        ))}
        {envelope.snapshot.updates.filter((update) => !turnIds.has(update.turnId)).map((update) => (
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
                pttHeldRef.current = false;
                setPttHeld(false);
                pttCapturingRef.current = false;
                captureAttemptRef.current += 1;
                voice?.stopTurn();
                setMode("typing");
              }}
              aria-label="Switch to typing"
            >⌨</button>
            <button
              className="mic primary"
              aria-pressed={mode === "ptt" && pttHeld}
              onPointerDown={(event) => {
                if (mode !== "ptt") return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                pttHeldRef.current = true;
                setPttHeld(true);
                beginVoiceCapture(mode);
              }}
              onPointerUp={() => { if (mode === "ptt") endPushToTalk(); }}
              onPointerCancel={() => { if (mode === "ptt") endPushToTalk(); }}
            >
              {mode === "handsfree"
                ? "Listening hands-free"
                : pttHeld
                  ? "Listening… release to send"
                  : "Hold to talk"}
            </button>
            <button
              aria-pressed={mode === "handsfree"}
              onClick={() => {
                const next = mode === "handsfree" ? "ptt" : "handsfree";
                captureAttemptRef.current += 1;
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
