import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountDataDeletionIncompleteError } from "@/lib/account-data-deletion";
import {
  MomentApiRateLimitExceededError,
  MomentApiRateLimitUnavailableError,
} from "@/lib/moment-api-rate-limit";

const {
  createAuthenticatedClientMock,
  deleteAccountDataMock,
  enforceRateLimitMock,
  imageRepositoryMock,
  order,
  repositoryMock,
  requireReverificationMock,
} = vi.hoisted(() => ({
  createAuthenticatedClientMock: vi.fn(),
  deleteAccountDataMock: vi.fn(),
  enforceRateLimitMock: vi.fn(),
  imageRepositoryMock: { kind: "images" },
  order: [] as string[],
  repositoryMock: { kind: "deletion-repository" },
  requireReverificationMock: vi.fn(),
}));

vi.mock("@/lib/account-data-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-data-deletion")>()),
  deleteAccountData: deleteAccountDataMock,
}));

vi.mock("@/lib/account-export-server", () => ({
  requireStrictAccountReverification: requireReverificationMock,
}));

vi.mock("@/lib/moment-api-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/moment-api-rate-limit")>()),
  enforceMomentApiRateLimit: enforceRateLimitMock,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createAuthenticatedSupabaseClient: createAuthenticatedClientMock,
}));

vi.mock("@/repositories/supabase-account-data-deletion-repository", () => ({
  SupabaseAccountDataDeletionRepository: class {
    constructor() {
      return repositoryMock;
    }
  },
}));

vi.mock("@/repositories/supabase-moment-image-repository", () => ({
  SupabaseMomentImageRepository: class {
    constructor() {
      return imageRepositoryMock;
    }
  },
}));

import { DELETE, POST } from "./route";

function deleteRequest(confirmation = "DELETE MY DATA") {
  return new Request("http://localhost/api/account/data", {
    body: JSON.stringify({ confirmation }),
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  });
}

describe("/api/account/data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.splice(0);
    requireReverificationMock.mockImplementation(async () => {
      order.push("reverify");
      return null;
    });
    createAuthenticatedClientMock.mockImplementation(async () => {
      order.push("client");
      return { client: { kind: "supabase" }, userId: "user_a" };
    });
    enforceRateLimitMock.mockImplementation(async () => {
      order.push("rate-limit");
      return { limit: 2, remaining: 1, retryAfterSeconds: 60 };
    });
    deleteAccountDataMock.mockImplementation(async () => {
      order.push("delete-and-verify");
      return { deletedMoments: 2, deletedImages: 1 };
    });
  });

  it("performs a strict-reverification handshake without rate limit or deletion", async () => {
    const response = await POST();

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(order).toEqual(["reverify"]);
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
    expect(deleteAccountDataMock).not.toHaveBeenCalled();
  });

  it("authenticates and reverifies before rate limiting and deleting owner data", async () => {
    const response = await DELETE(deleteRequest());

    expect(order).toEqual([
      "reverify",
      "client",
      "rate-limit",
      "delete-and-verify",
    ]);
    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      { kind: "supabase" },
      "delete-data",
    );
    expect(deleteAccountDataMock).toHaveBeenCalledWith(
      repositoryMock,
      imageRepositoryMock,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns Clerk's auth/reverification response before client or limiter work", async () => {
    requireReverificationMock.mockResolvedValueOnce(
      Response.json(
        { clerk_error: { reason: "reverification-error" } },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      ),
    );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(403);
    expect(createAuthenticatedClientMock).not.toHaveBeenCalled();
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
    expect(deleteAccountDataMock).not.toHaveBeenCalled();
  });

  it("preserves standard 429 metadata and performs no deletion after the limit", async () => {
    enforceRateLimitMock.mockRejectedValueOnce(
      new MomentApiRateLimitExceededError({
        limit: 2,
        remaining: 0,
        retryAfterSeconds: 31,
      }),
    );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("31");
    expect(response.headers.get("ratelimit-limit")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(deleteAccountDataMock).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter is unavailable", async () => {
    enforceRateLimitMock.mockRejectedValueOnce(
      new MomentApiRateLimitUnavailableError(),
    );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The Moment service is temporarily unavailable.",
      },
    });
    expect(deleteAccountDataMock).not.toHaveBeenCalled();
  });

  it("returns the explicit retryable 503 when final zero-state verification is incomplete", async () => {
    deleteAccountDataMock.mockRejectedValueOnce(
      new AccountDataDeletionIncompleteError(0, 1, 1, 1),
    );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ACCOUNT_DATA_DELETION_INCOMPLETE",
        message:
          "Your cloud data deletion is incomplete. Please try again.",
      },
    });
  });

  it("uses the approved incomplete contract when post-begin provider state is unknown", async () => {
    deleteAccountDataMock.mockRejectedValueOnce(
      new AccountDataDeletionIncompleteError(null, null, null, null),
    );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ACCOUNT_DATA_DELETION_INCOMPLETE",
        message: "Your cloud data deletion is incomplete. Please try again.",
      },
    });
  });

  it("sanitizes unexpected provider errors", async () => {
    deleteAccountDataMock.mockRejectedValueOnce(
      new Error("private object path or token"),
    );

    const response = await DELETE(deleteRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("private object path");
  });

  it("rejects a missing or incorrect confirmation after reverification and before any database work", async () => {
    const response = await DELETE(deleteRequest("delete my data"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_CONFIRMATION",
        message: "The account data deletion confirmation is invalid.",
      },
    });
    expect(order).toEqual(["reverify"]);
    expect(createAuthenticatedClientMock).not.toHaveBeenCalled();
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
    expect(deleteAccountDataMock).not.toHaveBeenCalled();
  });

  it("never accepts a client-supplied owner identity", async () => {
    const request = new Request("http://localhost/api/account/data", {
      body: JSON.stringify({
        confirmation: "DELETE MY DATA",
        ownerId: "user_b",
      }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });

    const response = await DELETE(request);

    expect(response.status).toBe(400);
    expect(createAuthenticatedClientMock).not.toHaveBeenCalled();
    expect(deleteAccountDataMock).not.toHaveBeenCalled();
  });
});
