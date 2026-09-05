import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  setClerkTestReverificationWrapper,
  type ClerkTestReverificationOperation,
} from "@/test/clerk-test-state";

import { AccountDataDeletionDialog } from "./account-data-deletion-action";

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

describe("AccountDataDeletionDialog", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("explains the cloud-only scope and requires the exact confirmation phrase", () => {
    render(
      <AccountDataDeletionDialog
        open
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Delete cloud data" })).not.toBeNull();
    expect(screen.getByText(/Clerk account stays active/i)).not.toBeNull();
    expect(screen.getByText(/browser-local legacy Moments are not deleted/i)).not.toBeNull();
    const input = screen.getByLabelText(/Type DELETE MY DATA/i);
    const submit = screen.getByRole("button", { name: "Delete cloud data" });
    expect(document.activeElement).toBe(input);
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "delete my data" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "DELETE MY DATA" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses Clerk strict reverification before the real DELETE and reports verified success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(clerkHintResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    setClerkTestReverificationWrapper(
      async (operation: ClerkTestReverificationOperation) => {
        const result = await operation();
        return result && typeof result === "object" && "clerk_error" in result
          ? operation()
          : result;
      },
    );
    const onClose = vi.fn();
    const onDeleted = vi.fn();

    render(
      <AccountDataDeletionDialog
        open
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE MY DATA/i), {
      target: { value: "DELETE MY DATA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/account/data", {
      cache: "no-store",
      method: "POST",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/account/data", {
      cache: "no-store",
      method: "POST",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/account/data", {
      body: JSON.stringify({ confirmation: "DELETE MY DATA" }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
      signal: expect.any(AbortSignal),
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks duplicate activation while deletion is in progress", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AccountDataDeletionDialog open onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE MY DATA/i), {
      target: { value: "DELETE MY DATA" },
    });
    const submit = screen.getByRole("button", { name: "Delete cloud data" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Deleting");
  });

  it("keeps incomplete work retryable and never reports false success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "ACCOUNT_DATA_DELETION_INCOMPLETE",
              message: "private detail",
            },
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const onDeleted = vi.fn();
    localStorage.setItem("mood-and-moments.moments.v1", "legacy-source");

    render(
      <AccountDataDeletionDialog open onClose={vi.fn()} onDeleted={onDeleted} />,
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE MY DATA/i), {
      target: { value: "DELETE MY DATA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));

    const retry = await screen.findByRole("button", { name: "Retry cleanup" });
    expect(screen.getByRole("alert").textContent).toContain("incomplete");
    expect(screen.getByRole("alert").textContent).not.toContain("private detail");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(localStorage.getItem("mood-and-moments.moments.v1")).toBe("legacy-source");

    fireEvent.click(retry);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("announces reverification cancellation without starting deletion", async () => {
    vi.stubGlobal("fetch", vi.fn());
    setClerkTestReverificationWrapper(async () => {
      throw { clerkReverificationCancelled: true };
    });

    render(
      <AccountDataDeletionDialog open onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE MY DATA/i), {
      target: { value: "DELETE MY DATA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("cancelled"),
    );
  });

  it("sanitizes ambiguous failures and offers a safe retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new Error("private network detail"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AccountDataDeletionDialog open onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE MY DATA/i), {
      target: { value: "DELETE MY DATA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));

    expect(await screen.findByRole("button", { name: "Retry cleanup" })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain("private network");
  });

  it("bounds an ambiguous deletion request and keeps it safely retryable", async () => {
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

    render(
      <AccountDataDeletionDialog open onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE MY DATA/i), {
      target: { value: "DELETE MY DATA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(screen.getByRole("alert").textContent).toContain("could not be verified");
    expect(screen.getByRole("button", { name: "Retry cleanup" })).not.toBeNull();
    vi.useRealTimers();
  });

  it("applies the same 120-second timeout to the Clerk authorization handshake", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AccountDataDeletionDialog open onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE MY DATA/i), {
      target: { value: "DELETE MY DATA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("could not be verified");
    expect(screen.getByRole("button", { name: "Retry cleanup" })).not.toBeNull();
    vi.useRealTimers();
  });

  it("traps focus, makes the background inert, and restores focus when closed", () => {
    const background = document.createElement("main");
    const opener = document.createElement("button");
    opener.textContent = "Open deletion";
    background.append(opener);
    document.body.append(background);
    opener.focus();

    const view = render(
      <AccountDataDeletionDialog open onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    const input = screen.getByLabelText(/Type DELETE MY DATA/i);
    const keep = screen.getByRole("button", { name: "Keep my data" });

    expect(background.inert).toBe(true);
    expect(document.activeElement).toBe(input);
    keep.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Tab",
      shiftKey: true,
    });
    expect(document.activeElement).toBe(keep);

    view.rerender(
      <AccountDataDeletionDialog open={false} onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    expect(background.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
    background.remove();
  });

  it("uses the supplied stable focus target when the Clerk menu action is gone", () => {
    const transientAction = document.createElement("button");
    const stableAccountButton = document.createElement("button");
    transientAction.textContent = "Transient Clerk action";
    stableAccountButton.textContent = "Account menu";
    document.body.append(transientAction, stableAccountButton);
    transientAction.focus();

    const view = render(
      <AccountDataDeletionDialog
        open
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        restoreFocus={() => stableAccountButton.focus()}
      />,
    );
    transientAction.remove();
    view.rerender(
      <AccountDataDeletionDialog
        open={false}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        restoreFocus={() => stableAccountButton.focus()}
      />,
    );

    expect(document.activeElement).toBe(stableAccountButton);
    stableAccountButton.remove();
  });
});
