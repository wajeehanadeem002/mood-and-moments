import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  enforceMomentApiRateLimit,
  MomentApiRateLimitExceededError,
  MomentApiRateLimitUnavailableError,
} from "./moment-api-rate-limit";

function clientWithRpc(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);

  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

function clientWithRejectedRpc(error: unknown) {
  const rpc = vi.fn().mockRejectedValue(error);

  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("enforceMomentApiRateLimit", () => {
  it("allows a request below its authenticated operation-bucket limit", async () => {
    const { client, rpc } = clientWithRpc({
      data: [
        {
          allowed: true,
          limit_value: 120,
          remaining: 119,
          retry_after_seconds: 60,
        },
      ],
      error: null,
    });

    await expect(enforceMomentApiRateLimit(client, "read")).resolves.toEqual({
      limit: 120,
      remaining: 119,
      retryAfterSeconds: 60,
    });
    expect(rpc).toHaveBeenCalledWith("consume_moment_api_rate_limit", {
      requested_bucket: "read",
    });
  });

  it("allows the final request at the exact limit boundary", async () => {
    const { client } = clientWithRpc({
      data: [
        {
          allowed: true,
          limit_value: 30,
          remaining: 0,
          retry_after_seconds: 17,
        },
      ],
      error: null,
    });

    await expect(
      enforceMomentApiRateLimit(client, "mutation"),
    ).resolves.toEqual({
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 17,
    });
  });

  it("rejects an exceeded bucket with the database-owned limit metadata", async () => {
    const { client } = clientWithRpc({
      data: [
        {
          allowed: false,
          limit_value: 10,
          remaining: 0,
          retry_after_seconds: 23,
        },
      ],
      error: null,
    });

    await expect(enforceMomentApiRateLimit(client, "import")).rejects.toEqual(
      expect.objectContaining({
        limit: 10,
        name: MomentApiRateLimitExceededError.name,
        remaining: 0,
        retryAfterSeconds: 23,
      }),
    );
  });

  it("fails closed when the database limiter cannot operate", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { message: "private database detail" },
    });

    await expect(enforceMomentApiRateLimit(client, "read")).rejects.toEqual(
      expect.objectContaining({
        name: MomentApiRateLimitUnavailableError.name,
      }),
    );
  });

  it("fails closed when the limiter request rejects before returning a result", async () => {
    const { client } = clientWithRejectedRpc(
      new Error("private network detail"),
    );

    await expect(enforceMomentApiRateLimit(client, "read")).rejects.toEqual(
      expect.objectContaining({
        name: MomentApiRateLimitUnavailableError.name,
      }),
    );
  });

  it("fails closed when the database returns malformed limiter data", async () => {
    const { client } = clientWithRpc({
      data: [{ allowed: true, limit_value: 120, remaining: -1 }],
      error: null,
    });

    await expect(enforceMomentApiRateLimit(client, "read")).rejects.toEqual(
      expect.objectContaining({
        name: MomentApiRateLimitUnavailableError.name,
      }),
    );
  });

  it("fails closed when a denied result reports remaining allowance", async () => {
    const { client } = clientWithRpc({
      data: [
        {
          allowed: false,
          limit_value: 120,
          remaining: 1,
          retry_after_seconds: 7,
        },
      ],
      error: null,
    });

    await expect(enforceMomentApiRateLimit(client, "read")).rejects.toEqual(
      expect.objectContaining({
        name: MomentApiRateLimitUnavailableError.name,
      }),
    );
  });
});
