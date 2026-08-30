import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clerkMiddlewareMock, proxyHandler } = vi.hoisted(() => ({
  clerkMiddlewareMock: vi.fn(),
  proxyHandler: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: clerkMiddlewareMock,
}));

const originalAuthorizedParties = process.env.CLERK_AUTHORIZED_PARTIES;

function configureAuthorizedParties(value: string | undefined) {
  if (value === undefined) {
    delete process.env.CLERK_AUTHORIZED_PARTIES;
    return;
  }

  process.env.CLERK_AUTHORIZED_PARTIES = value;
}

describe("Clerk proxy security", () => {
  beforeEach(() => {
    vi.resetModules();
    clerkMiddlewareMock.mockReset();
    clerkMiddlewareMock.mockReturnValue(proxyHandler);
  });

  afterEach(() => {
    configureAuthorizedParties(originalAuthorizedParties);
  });

  it("restricts an unconfigured local environment to explicit loopback origins", async () => {
    configureAuthorizedParties(undefined);

    const proxyModule = await import("./proxy");

    expect(clerkMiddlewareMock).toHaveBeenCalledOnce();
    expect(clerkMiddlewareMock).toHaveBeenCalledWith({
      authorizedParties: [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ],
    });
    expect(proxyModule.default).toBe(proxyHandler);
  });

  it("uses only normalized, unique configured origins", async () => {
    configureAuthorizedParties(
      " https://APP.example.com/, https://www.example.com,https://app.example.com ",
    );

    await import("./proxy");

    expect(clerkMiddlewareMock).toHaveBeenCalledWith({
      authorizedParties: [
        "https://app.example.com",
        "https://www.example.com",
      ],
    });
  });

  it.each([
    ["an empty configuration", ""],
    ["an empty list entry", "https://example.com,,https://www.example.com"],
    ["a non-origin value", "not-an-origin"],
    ["a wildcard", "https://*.example.com"],
    ["credentials", "https://user@example.com"],
    ["a path", "https://example.com/path"],
    ["a path normalized away", "https://example.com/foo/.."],
    ["an encoded dot path", "https://example.com/%2e"],
    ["a query", "https://example.com?preview=true"],
    ["an empty query", "https://example.com?"],
    ["an empty fragment", "https://example.com#"],
    ["empty credentials", "https://@example.com"],
    ["backslash separators", "https:\\example.com"],
    ["a public HTTP origin", "http://example.com"],
  ])("fails closed for %s", async (_label, value) => {
    configureAuthorizedParties(value);

    await expect(import("./proxy")).rejects.toThrow(
      "CLERK_AUTHORIZED_PARTIES",
    );
    expect(clerkMiddlewareMock).not.toHaveBeenCalled();
  });

  it("preserves the existing Next.js proxy matcher", async () => {
    configureAuthorizedParties(undefined);

    const { config } = await import("./proxy");

    expect(config).toEqual({
      matcher: [
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        "/(api|trpc)(.*)",
      ],
    });
  });
});
