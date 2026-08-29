import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignInPage from "./page";

describe("SignInPage", () => {
  it("renders the Clerk sign-in flow with a return to Moment creation", () => {
    render(<SignInPage />);

    expect(
      screen.getByRole("heading", { name: "Sign in to Mood & Moments" }),
    ).not.toBeNull();
    expect(
      screen.getByTestId("clerk-sign-in").getAttribute(
        "data-fallback-redirect-url",
      ),
    ).toBe("/#moods");
  });
});
