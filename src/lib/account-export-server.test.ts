import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, reverificationErrorResponseMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  reverificationErrorResponseMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  reverificationErrorResponse: reverificationErrorResponseMock,
}));

import { requireStrictAccountReverification } from "./account-export-server";

describe("requireStrictAccountReverification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reverificationErrorResponseMock.mockReturnValue(
      Response.json(
        { clerk_error: { reason: "reverification-error" } },
        { status: 403 },
      ),
    );
  });

  it("returns a private 401 before checking reverification when signed out", async () => {
    const has = vi.fn();
    authMock.mockResolvedValue({ has, isAuthenticated: false, userId: null });

    const response = await requireStrictAccountReverification();

    expect(response?.status).toBe(401);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(has).not.toHaveBeenCalled();
    expect(reverificationErrorResponseMock).not.toHaveBeenCalled();
  });

  it("returns Clerk's strict reverification response with private caching", async () => {
    const has = vi.fn().mockReturnValue(false);
    authMock.mockResolvedValue({
      has,
      isAuthenticated: true,
      userId: "user_a",
    });

    const response = await requireStrictAccountReverification();

    expect(has).toHaveBeenCalledWith({ reverification: "strict" });
    expect(reverificationErrorResponseMock).toHaveBeenCalledWith("strict");
    expect(response?.status).toBe(403);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    await expect(response?.json()).resolves.toEqual({
      clerk_error: { reason: "reverification-error" },
    });
  });

  it("allows a strictly reverified authenticated session", async () => {
    const has = vi.fn().mockReturnValue(true);
    authMock.mockResolvedValue({
      has,
      isAuthenticated: true,
      userId: "user_a",
    });

    await expect(requireStrictAccountReverification()).resolves.toBeNull();
    expect(has).toHaveBeenCalledWith({ reverification: "strict" });
    expect(reverificationErrorResponseMock).not.toHaveBeenCalled();
  });
});
