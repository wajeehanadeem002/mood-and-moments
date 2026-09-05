import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { setClerkTestAuthState } from "@/test/clerk-test-state";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("opens and closes the mobile navigation with an announced state", () => {
    render(<SiteHeader />);
    const toggle = screen.getByRole("button", { name: "Open navigation" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows sign-in and sign-up actions when signed out", () => {
    setClerkTestAuthState({ isSignedIn: false, userId: null });

    render(<SiteHeader />);

    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sign up" })).not.toBeNull();
    expect(screen.queryByLabelText("Account")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Export my data" }),
    ).toBeNull();
  });

  it("shows the account control and creation action when signed in", () => {
    render(<SiteHeader />);

    expect(screen.getByLabelText("Account")).not.toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Export my data" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", {
        name: "Delete my Mood & Moments data",
      }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Create a Moment" }),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign up" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(
      screen.getAllByRole("button", { name: "Export my data" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", {
        name: "Delete my Mood & Moments data",
      }),
    ).toHaveLength(2);
  });
});
