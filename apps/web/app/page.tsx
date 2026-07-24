import type { TaskView } from "@voice-agent/contracts";
import Link from "next/link";
import React from "react";

export const recentTasks = [
  {
    id: "checkout",
    title: "Fix checkout regression",
    status: "needs_input",
    createdAt: "2026-07-24T18:00:00.000Z",
    updatedAt: "2026-07-24T19:58:00.000Z",
  },
  {
    id: "launch-brief",
    title: "Prepare Q3 launch brief",
    status: "working",
    createdAt: "2026-07-24T17:00:00.000Z",
    updatedAt: "2026-07-24T19:52:00.000Z",
  },
  {
    id: "analytics",
    title: "Update analytics dashboard",
    status: "completed",
    createdAt: "2026-07-24T15:00:00.000Z",
    updatedAt: "2026-07-24T19:00:00.000Z",
  },
] satisfies TaskView[];

const labels: Record<TaskView["status"], string> = {
  queued: "Queued",
  working: "Working",
  needs_input: "Needs your input",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function Home() {
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
        <Link className="start-voice" href="/tasks/new?mode=ptt">
          <span className="start-pulse" aria-hidden="true" /> Push to talk
        </Link>
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
                <time dateTime={task.updatedAt}>
                  {task.id === "analytics" ? "1h" : task.id === "launch-brief" ? "8m" : "2m"}
                </time>
              </span>
            </Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
