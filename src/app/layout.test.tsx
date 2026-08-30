import { ClerkProvider } from "@clerk/nextjs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Cormorant_Garamond: () => ({ variable: "font-cormorant" }),
  Geist: () => ({ variable: "font-geist" }),
}));

import RootLayout from "./layout";

describe("RootLayout security integration", () => {
  it("opts Clerk into dynamic rendering for strict nonce propagation", () => {
    const layout = RootLayout({
      children: <main>Content</main>,
      params: Promise.resolve({}),
    });
    const body = layout.props.children;
    const provider = body.props.children;

    expect(provider.type).toBe(ClerkProvider);
    expect(provider.props).toMatchObject({
      dynamic: true,
      signInUrl: "/sign-in",
      signUpUrl: "/sign-up",
    });
  });
});
