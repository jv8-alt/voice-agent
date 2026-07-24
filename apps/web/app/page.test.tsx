import { render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

describe("voice-first home", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("puts every voice action before recent tasks", () => {
    render(<Home />);

    const controls = [
      screen.getByRole("link", { name: /push to talk/i }),
      screen.getByRole("link", { name: /hands-free/i }),
      screen.getByRole("link", { name: /type instead/i }),
    ];
    const recent = screen.getByRole("heading", { name: /recent tasks/i });

    controls.forEach((control) => {
      expect(control.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("links start modes and live recent tasks to their destinations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tasks: [{
        id: "checkout",
        title: "Fix checkout regression",
        status: "working",
        createdAt: "2026-07-24T18:00:00.000Z",
        updatedAt: "2026-07-24T19:58:00.000Z",
      }],
    }), { status: 200 })));
    render(<Home />);

    expect(screen.getByRole("link", { name: /push to talk/i })).toHaveAttribute(
      "href",
      "/tasks/new?mode=ptt",
    );
    const recent = screen.getByRole("navigation", { name: /recent tasks/i });
    expect(await within(recent).findByRole("link", { name: /fix checkout regression/i })).toHaveAttribute(
      "href",
      "/tasks/checkout",
    );
  });
});
