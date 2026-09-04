import { cleanup } from "@testing-library/react";
import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, vi } from "vitest";

import {
  clerkTestAuthState,
  clerkTestReverificationState,
  resetClerkTestAuthState,
} from "@/test/clerk-test-state";

vi.mock("@clerk/nextjs", () => {
  function UserButton({ children }: { children?: ReactNode }) {
    return createElement(
      Fragment,
      null,
      createElement("button", {
        "aria-label": "Open user menu",
        type: "button",
      }),
      children,
    );
  }
  function UserButtonMenuItems({ children }: { children?: ReactNode }) {
    return createElement(Fragment, null, children);
  }
  function UserButtonAction({
    label,
    labelIcon,
    onClick,
  }: {
    label: string;
    labelIcon?: ReactNode;
    onClick?: () => void;
  }) {
    return createElement(
      "button",
      { onClick, type: "button" },
      labelIcon,
      label,
    );
  }
  UserButton.MenuItems = UserButtonMenuItems;
  UserButton.Action = UserButtonAction;

  return {
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
    UserButton,
    useAuth: () => ({ ...clerkTestAuthState }),
    useReverification:
      (fetcher: (...args: unknown[]) => Promise<unknown>) =>
      (...args: unknown[]) => {
        const operation = () => fetcher(...args);
        return clerkTestReverificationState.wrapper
          ? clerkTestReverificationState.wrapper(operation)
          : operation();
      },
  };
});

vi.mock("@clerk/nextjs/errors", () => ({
  isReverificationCancelledError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "clerkReverificationCancelled" in error,
    ),
}));

afterEach(() => {
  cleanup();
  resetClerkTestAuthState();
});
