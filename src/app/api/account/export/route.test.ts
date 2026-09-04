import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountDataExportError } from "@/lib/account-data-export";
import {
  MomentApiRateLimitExceededError,
  MomentApiRateLimitUnavailableError,
} from "@/lib/moment-api-rate-limit";
import { SupabaseAuthenticationError } from "@/lib/supabase/server";

const {
  createAccountDataExportMock,
  createAuthenticatedClientMock,
  enforceRateLimitMock,
  order,
  requireReverificationMock,
} = vi.hoisted(() => ({
  createAccountDataExportMock: vi.fn(),
  createAuthenticatedClientMock: vi.fn(),
  enforceRateLimitMock: vi.fn(),
  order: [] as string[],
  requireReverificationMock: vi.fn(),
}));

vi.mock("@/lib/account-data-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-data-export")>()),
  createAccountDataExport: createAccountDataExportMock,
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

import { GET, POST } from "./route";

function archiveStream(bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("/api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.splice(0);
    requireReverificationMock.mockImplementation(async () => {
      order.push("reverify");
      return null;
    });
    createAuthenticatedClientMock.mockImplementation(async () => {
      order.push("client");
      return { client: { kind: "authenticated-supabase" }, userId: "user_a" };
    });
    enforceRateLimitMock.mockImplementation(async () => {
      order.push("rate-limit");
      return { limit: 2, remaining: 1, retryAfterSeconds: 60 };
    });
    createAccountDataExportMock.mockImplementation(async () => {
      order.push("data-and-images");
      return {
        fileName: "mood-and-moments-export-2026-09-04.zip",
        stream: archiveStream(),
      };
    });
  });

  it("performs a lightweight strict-reverification handshake without consuming an allowance", async () => {
    const response = await POST();

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(order).toEqual(["reverify"]);
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
    expect(createAccountDataExportMock).not.toHaveBeenCalled();
  });

  it("returns the authentication or strict-reverification response before any export work", async () => {
    requireReverificationMock.mockResolvedValueOnce(
      Response.json(
        { clerk_error: { reason: "reverification-error" } },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      ),
    );

    const response = await GET();

    expect(response.status).toBe(403);
    expect(createAuthenticatedClientMock).not.toHaveBeenCalled();
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
    expect(createAccountDataExportMock).not.toHaveBeenCalled();
  });

  it("authenticates and reverifies, rate limits, then reads data and streams a private ZIP", async () => {
    const response = await GET();

    expect(order).toEqual([
      "reverify",
      "client",
      "rate-limit",
      "data-and-images",
    ]);
    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      { kind: "authenticated-supabase" },
      "export",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="mood-and-moments-export-2026-09-04.zip"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );
  });

  it("fails closed if the Clerk session disappears after reverification", async () => {
    createAuthenticatedClientMock.mockRejectedValueOnce(
      new SupabaseAuthenticationError(
        "Authentication is required to access Supabase.",
      ),
    );

    const response = await GET();

    expect(response.status).toBe(401);
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
    expect(createAccountDataExportMock).not.toHaveBeenCalled();
  });

  it("preserves 429 metadata and performs no reads after an exceeded export allowance", async () => {
    enforceRateLimitMock.mockRejectedValueOnce(
      new MomentApiRateLimitExceededError({
        limit: 2,
        remaining: 0,
        retryAfterSeconds: 23,
      }),
    );

    const response = await GET();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    expect(response.headers.get("ratelimit-limit")).toBe("2");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createAccountDataExportMock).not.toHaveBeenCalled();
  });

  it("fails closed with 503 and performs no reads when the export limiter is unavailable", async () => {
    enforceRateLimitMock.mockRejectedValueOnce(
      new MomentApiRateLimitUnavailableError(),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(createAccountDataExportMock).not.toHaveBeenCalled();
  });

  it("does not expose private provider details when archive preparation fails", async () => {
    createAccountDataExportMock.mockRejectedValueOnce(
      new AccountDataExportError("private image path or provider detail"),
    );

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The Moment service is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private image path");
  });
});
