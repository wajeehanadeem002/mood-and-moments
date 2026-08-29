import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignUpPage from "./page";

describe("SignUpPage", () => {
  it("renders the Clerk sign-up flow with a return to Moment creation", () => {
    render(<SignUpPage />);

    expect(
      screen.getByRole("heading", { name: "Create your Mood & Moments account" }),
    ).not.toBeNull();
    expect(
      screen.getByTestId("clerk-sign-up").getAttribute(
        "data-fallback-redirect-url",
      ),
    ).toBe("/#moods");
  });
});
