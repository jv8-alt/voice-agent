"use client";

import type { TaskView } from "@voice-agent/contracts";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { TaskRestClient } from "../lib/task-client";
import { HomeVoiceStarter } from "./home-voice-starter";

const labels: Record<TaskView["status"], string> = {
  queued: "Queued",
  working: "Working",
  needs_input: "Needs your input",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function Home() {
  const [recentTasks, setRecentTasks] = useState<TaskView[]>([]);
  useEffect(() => {
    const client = new TaskRestClient(process.env.NEXT_PUBLIC_TASK_API_URL ?? "http://localhost:3001");
    void client.list().then(({ tasks }) => setRecentTasks(tasks)).catch(() => {});
  }, []);
  return (
    <main className="home-shell">
      <header className="home-header">
        <div>
          <p className="eyebrow">VOICE AGENT</p>
          <h1>Good morning</h1>
        </div>
        <button className="icon-button" aria-label="Account and sync">☁</button>
      </header>

      <section className="start-card" aria-labelledby="start-heading">
        <h2 id="start-heading">What should I work on?</h2>
        <p>Start speaking now, or type your request.</p>
        <HomeVoiceStarter />
        <div className="start-options">
          <Link href="/tasks/new?mode=handsfree">∞ Hands-free</Link>
          <Link href="/tasks/new?mode=typing">⌨ Type instead</Link>
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <div className="recent-heading">
          <h2 id="recent-heading">Recent tasks</h2>
          <span>Synced</span>
        </div>
        <nav aria-label="Recent tasks">
          {recentTasks.map((task) => (
            <Link className="task" href={`/tasks/${task.id}`} key={task.id}>
              <strong>{task.title}</strong>
              <span className="task-meta">
                <span><i className={`dot ${task.status}`} />{labels[task.status]}</span>
                <time dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
              </span>
            </Link>
          ))}
          {recentTasks.length === 0 && <p className="empty-tasks">No tasks yet. Start with your voice.</p>}
        </nav>
      </section>
    </main>
  );
}
