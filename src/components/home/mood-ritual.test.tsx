import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MoodRitual } from "./mood-ritual";

describe("MoodRitual", () => {
  it("groups the mood choices under an accessible name", () => {
    render(<MoodRitual />);

    expect(
      screen.getByRole("group", { name: "Choose a mood" }),
    ).not.toBeNull();
  });

  it("uses the visible submit label as its accessible name", () => {
    render(<MoodRitual />);

    expect(
      screen.getByRole("button", { name: "Create a Moment" }),
    ).not.toBeNull();
  });

  it("updates the selected mood through an accessible pressed state", () => {
    render(<MoodRitual />);
    const calm = screen.getByRole("button", { name: "Calm" });

    fireEvent.click(calm);

    expect(calm.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByText("Moments of ease, clarity, and quiet."),
    ).not.toBeNull();
  });

  it("focuses the textarea and announces validation for an empty moment", () => {
    render(<MoodRitual />);
    const field = screen.getByLabelText(
      "What is one moment that made you feel this way?",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create a Moment" }),
    );

    expect(document.activeElement).toBe(field);
    expect(
      screen.getByText(
        "Write a few words about the moment you want to remember.",
      ),
    ).not.toBeNull();
  });

  it("shows a non-persistent preview confirmation for valid input", () => {
    render(<MoodRitual />);
    const field = screen.getByLabelText(
      "What is one moment that made you feel this way?",
    );

    fireEvent.change(field, {
      target: { value: "Rain tapping against the glass" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create a Moment" }),
    );

    expect(
      screen.getByText("Your Happy moment is ready in this preview."),
    ).not.toBeNull();
  });
});
