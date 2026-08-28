import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Mood & Moments homepage", () => {
  it("renders the complete single-page experience with semantic landmarks", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Capture the moments. Feel the memories.",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Recent Moments" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Memory Timeline" }),
    ).not.toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("contentinfo")).not.toBeNull();
  });
});
