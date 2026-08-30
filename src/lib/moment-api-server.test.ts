import { describe, expect, it, vi } from "vitest";

import { MomentImageLifecycleError } from "@/lib/authenticated-moment-service";
import { MomentImportLifecycleError } from "@/lib/authenticated-moment-import-service";

import { handleMomentApiError } from "./moment-api-server";

describe("handleMomentApiError", () => {
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
