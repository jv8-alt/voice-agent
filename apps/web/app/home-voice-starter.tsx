"use client";

import type { SnapshotEnvelope, VoiceSession } from "@voice-agent/contracts";
import { OpenAIVoiceSession } from "@voice-agent/voice-openai";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TaskRestClient } from "../lib/task-client";

interface HomeVoiceRest {
  create(input: {
    title: string;
    turn: { mode: "ptt"; text: string };
  }): Promise<SnapshotEnvelope>;
  createVoiceClientSecret(): Promise<{ clientSecret: string }>;
}

export interface HomeVoiceDependencies {
  readonly rest: HomeVoiceRest;
  readonly voice: VoiceSession;
}

function defaultDependencies(): HomeVoiceDependencies {
  const apiUrl = process.env.NEXT_PUBLIC_TASK_API_URL ?? "http://localhost:3001";
  return {
    rest: new TaskRestClient(apiUrl),
    voice: new OpenAIVoiceSession(),
  };
}

export function HomeVoiceStarter({
  dependencies,
}: {
  readonly dependencies?: HomeVoiceDependencies;
}) {
  const router = useRouter();
  const services = useMemo(() => dependencies ?? defaultDependencies(), [dependencies]);
  const [held, setHeld] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const heldRef = useRef(false);
  const capturingRef = useRef(false);
  const captureAttempt = useRef(0);
  const readyRef = useRef(false);
  const connectingRef = useRef<Promise<boolean> | null>(null);
  const submittingRef = useRef(false);

  const connectVoice = useCallback((): Promise<boolean> => {
    if (readyRef.current) return Promise.resolve(true);
    if (connectingRef.current) return connectingRef.current;
    setMessage("Connecting microphone…");
    const pending = services.rest.createVoiceClientSecret()
      .then(({ clientSecret }) => services.voice.connect({ clientSecret }))
      .then(() => {
        readyRef.current = true;
        setMessage(null);
        return true;
      })
      .catch(() => {
        setMessage("Allow microphone access, then hold again to talk.");
        return false;
      })
      .finally(() => {
        connectingRef.current = null;
      });
    connectingRef.current = pending;
    return pending;
  }, [services]);

  useEffect(() => {
    const unsubscribe = services.voice.onTranscript(({ final, text }) => {
      const request = text.trim();
      if (!final || !request || submittingRef.current) return;
      submittingRef.current = true;
      setMessage("Starting task…");
      void services.rest.create({
        title: request.slice(0, 72),
        turn: { mode: "ptt", text: request },
      }).then((envelope) => {
        router.push(`/tasks/${envelope.snapshot.task.id}`);
      }).catch(() => {
        submittingRef.current = false;
        setMessage("Unable to start the task. Hold to try again.");
      });
    });
    return () => {
      unsubscribe();
      void services.voice.disconnect();
    };
  }, [router, services]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    void navigator.permissions.query({ name: "microphone" as PermissionName })
      .then(({ state }) => {
        if (state === "granted") void connectVoice();
      })
      .catch(() => {});
  }, [connectVoice]);

  const begin = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    heldRef.current = true;
    setHeld(true);
    const attempt = ++captureAttempt.current;
    void connectVoice().then((ready) => {
      if (!ready || !heldRef.current || captureAttempt.current !== attempt) return;
      services.voice.startTurn("ptt");
      capturingRef.current = true;
      setCapturing(true);
    });
  };

  const end = () => {
    heldRef.current = false;
    setHeld(false);
    captureAttempt.current += 1;
    if (!capturingRef.current) return;
    capturingRef.current = false;
    setCapturing(false);
    services.voice.stopTurn();
    setMessage("Transcribing…");
  };

  return (
    <>
      <button
        type="button"
        className="start-voice"
        aria-pressed={held}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="start-pulse" aria-hidden="true" />
        {capturing
          ? "Listening… release to send"
          : held
            ? "Connecting… keep holding"
            : "Hold to talk"}
      </button>
      {message && <p className="home-voice-status" role="status">{message}</p>}
    </>
  );
}
