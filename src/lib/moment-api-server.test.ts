import { describe, expect, it, vi } from "vitest";

import { MomentImageLifecycleError } from "@/lib/authenticated-moment-service";
import { MomentImportLifecycleError } from "@/lib/authenticated-moment-import-service";
import {
  MomentApiRateLimitExceededError,
  MomentApiRateLimitUnavailableError,
} from "@/lib/moment-api-rate-limit";

import { handleMomentApiError } from "./moment-api-server";

describe("handleMomentApiError", () => {
  it("returns a private 429 response with retry and rate-limit metadata", async () => {
    const response = handleMomentApiError(
      new MomentApiRateLimitExceededError({
        limit: 10,
        remaining: 0,
        retryAfterSeconds: 23,
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("23");
    expect(response.headers.get("ratelimit-limit")).toBe("10");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("ratelimit-reset")).toBe("23");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again shortly.",
      },
    });
  });

  it("fails closed with 503 without exposing limiter failures", async () => {
    const response = handleMomentApiError(
      new MomentApiRateLimitUnavailableError({
        cause: new Error("private database detail"),
      }),
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The Moment service is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private database detail");
  });

  it("logs incomplete compensation without exposing details to the client", async () => {
    const cleanupFailure = new Error("private provider detail");
    const error = new MomentImageLifecycleError(
      "Moment creation could not complete and was rolled back.",
      [cleanupFailure],
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = handleMomentApiError(error);

    expect(consoleError).toHaveBeenCalledWith(
      "Moment image compensation cleanup did not complete.",
      error,
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The Moment service is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private provider detail");
  });

  it("logs incomplete import compensation without exposing provider details", async () => {
    const cleanupFailure = new Error("private import cleanup detail");
    const error = new MomentImportLifecycleError(
      "Legacy Moment image persistence could not complete.",
      [cleanupFailure],
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = handleMomentApiError(error);

    expect(consoleError).toHaveBeenCalledWith(
      "Moment image compensation cleanup did not complete.",
      error,
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private import cleanup detail",
    );
  });
});
