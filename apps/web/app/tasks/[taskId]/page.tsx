import type { TurnMode } from "@voice-agent/contracts";
import React from "react";
import { TaskExperience } from "./task-experience";

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { taskId } = await params;
  const requestedMode = (await searchParams).mode;
  const initialMode: TurnMode = requestedMode === "handsfree" || requestedMode === "typing"
    ? requestedMode
    : "ptt";
  return <TaskExperience taskId={taskId} initialMode={initialMode} />;
}
