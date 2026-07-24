import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("voice-first home", () => {
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

  it("links start modes and recent tasks to their destinations", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: /push to talk/i })).toHaveAttribute(
      "href",
      "/tasks/new?mode=ptt",
    );
    const recent = screen.getByRole("navigation", { name: /recent tasks/i });
    expect(within(recent).getByRole("link", { name: /fix checkout regression/i })).toHaveAttribute(
      "href",
      "/tasks/checkout",
    );
  });
});
