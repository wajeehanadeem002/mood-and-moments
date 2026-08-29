import { cleanup } from "@testing-library/react";
import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, vi } from "vitest";

import {
  clerkTestAuthState,
  resetClerkTestAuthState,
} from "@/test/clerk-test-state";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  Show: ({
    children,
    when,
  }: {
    children: ReactNode;
    when: "signed-in" | "signed-out";
  }) => {
    const shouldShow =
      when === "signed-in"
        ? clerkTestAuthState.isSignedIn
        : !clerkTestAuthState.isSignedIn;

    return shouldShow ? createElement(Fragment, null, children) : null;
  },
  SignIn: ({ fallbackRedirectUrl }: { fallbackRedirectUrl?: string }) =>
    createElement("div", {
      "data-fallback-redirect-url": fallbackRedirectUrl,
      "data-testid": "clerk-sign-in",
    }),
  SignInButton: ({ children }: { children: ReactNode }) => children,
  SignUp: ({ fallbackRedirectUrl }: { fallbackRedirectUrl?: string }) =>
    createElement("div", {
      "data-fallback-redirect-url": fallbackRedirectUrl,
      "data-testid": "clerk-sign-up",
    }),
  SignUpButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () =>
    createElement("button", { "aria-label": "Open user menu", type: "button" }),
  useAuth: () => ({ ...clerkTestAuthState }),
}));

afterEach(() => {
  cleanup();
  resetClerkTestAuthState();
});
