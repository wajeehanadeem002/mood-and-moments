import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  setClerkTestReverificationWrapper,
  type ClerkTestReverificationOperation,
} from "@/test/clerk-test-state";

import { AccountUserButton } from "./account-export-action";

const VALID_ZIP = new Uint8Array([
  80, 75, 3, 4, 20, 0, 0, 0, 0, 0, 166, 133, 36, 93, 67, 191, 166,
  163, 2, 0, 0, 0, 2, 0, 0, 0, 13, 0, 0, 0, 109, 97, 110, 105,
  102, 101, 115, 116, 46, 106, 115, 111, 110, 123, 125, 80, 75, 1, 2,
  20, 0, 20, 0, 0, 0, 0, 0, 166, 133, 36, 93, 67, 191, 166, 163, 2,
  0, 0, 0, 2, 0, 0, 0, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 109, 97, 110, 105, 102, 101, 115, 116, 46, 106, 115,
  111, 110, 80, 75, 5, 6, 0, 0, 0, 0, 1, 0, 1, 0, 59, 0, 0, 0, 45,
  0, 0, 0, 0, 0,
]);

function clerkHintResponse() {
  return Response.json(
    {
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: { reverification: "strict" },
      },
    },
    { status: 403 },
  );
}

function zipResponse() {
  return new Response(VALID_ZIP, {
    status: 200,
    headers: {
      "Content-Disposition":
        'attachment; filename="mood-and-moments-export-2026-09-04.zip"',
      "Content-Type": "application/zip",
    },
  });
}

function installDownloadSpies() {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  const createObjectURL = vi.fn(() => "blob:account-export");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

  return { click, createObjectURL, revokeObjectURL };
}

describe("AccountUserButton export action", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Clerk reverification before observing and saving the real ZIP response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(clerkHintResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(zipResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { click, createObjectURL, revokeObjectURL } = installDownloadSpies();
    setClerkTestReverificationWrapper(
      async (operation: ClerkTestReverificationOperation) => {
        const firstResult = await operation();
        if (
          firstResult &&
          typeof firstResult === "object" &&
          "clerk_error" in firstResult
        ) {
          return operation();
        }
        return firstResult;
      },
    );

    render(<AccountUserButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export my data" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Your data export is ready.",
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/account/export", {
      cache: "no-store",
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/account/export", {
      cache: "no-store",
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/account/export", {
      cache: "no-store",
      method: "GET",
      signal: expect.any(AbortSignal),
    });
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("blob:account-export");
    expect(anchor.download).toBe(
      "mood-and-moments-export-2026-09-04.zip",
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:account-export"),
    );
  });

  it("prevents duplicate export authorization while one is in progress", () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    installDownloadSpies();

    render(<AccountUserButton />);
    const action = screen.getByRole("button", { name: "Export my data" });
    fireEvent.click(action);
    fireEvent.click(action);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe(
      "Preparing your data export…",
    );
  });

  it("announces reverification cancellation without starting a download", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { click } = installDownloadSpies();
    setClerkTestReverificationWrapper(async () => {
      throw { clerkReverificationCancelled: true };
    });

    render(<AccountUserButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export my data" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Data export cancelled.",
      ),
    );
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    { status: 429, code: "RATE_LIMITED" },
    { status: 503, code: "SERVICE_UNAVAILABLE" },
    { status: 500, code: "INTERNAL_ERROR" },
  ])(
    "announces an actual GET $status failure without saving a file",
    async ({ status, code }) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          Response.json(
            { error: { code, message: "Private provider detail" } },
            { status },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      const { click } = installDownloadSpies();

      render(<AccountUserButton />);
      fireEvent.click(screen.getByRole("button", { name: "Export my data" }));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "couldn’t be downloaded",
        ),
      );
      expect(screen.getByRole("alert").textContent).not.toContain(
        "Private provider detail",
      );
      expect(click).not.toHaveBeenCalled();
    },
  );

  it("keeps the lock through the real GET and lets the user cancel it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementationOnce(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { click } = installDownloadSpies();

    render(<AccountUserButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export my data" }));

    const cancel = await screen.findByRole("button", {
      name: "Cancel data export",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(cancel);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Data export cancelled.",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(click).not.toHaveBeenCalled();
  });

  it("aborts a download that exceeds the bounded timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementationOnce(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    installDownloadSpies();

    render(<AccountUserButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export my data" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Your data export timed out. Please try again.",
    );
  });

  it("rejects a truncated 200 response instead of saving an invalid ZIP", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { click } = installDownloadSpies();

    render(<AccountUserButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export my data" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "couldn’t be downloaded",
      ),
    );
    expect(click).not.toHaveBeenCalled();
  });

  it("announces an actual GET failure and allows a later retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "INTERNAL_ERROR", message: "Private detail" } },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(zipResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { click } = installDownloadSpies();

    render(<AccountUserButton />);
    const action = screen.getByRole("button", { name: "Export my data" });
    fireEvent.click(action);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Your data export couldn’t be downloaded. Please try again.",
      ),
    );
    expect(screen.getByRole("alert").textContent).not.toContain(
      "Private detail",
    );

    fireEvent.click(action);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Your data export is ready.",
      ),
    );
    expect(click).toHaveBeenCalledOnce();
  });
});
