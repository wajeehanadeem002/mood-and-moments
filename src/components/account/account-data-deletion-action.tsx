"use client";

import { useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DeletionAuthorizationResult =
  | { authorized: true }
  | { clerk_error: unknown };

const confirmationPhrase = "DELETE MY DATA";
const deletionTimeoutMilliseconds = 120_000;

function isClerkReverificationHint(
  value: unknown,
): value is { clerk_error: unknown } {
  return Boolean(value && typeof value === "object" && "clerk_error" in value);
}

async function requestDeletionAuthorization(
  signal: AbortSignal,
): Promise<DeletionAuthorizationResult> {
  const response = await fetch("/api/account/data", {
    cache: "no-store",
    method: "POST",
    signal,
  });
  if (response.ok) return { authorized: true };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Account data deletion authorization failed.");
  }

  if (isClerkReverificationHint(body)) return body;
  throw new Error("Account data deletion authorization failed.");
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

async function isIncompleteDeletionResponse(response: Response) {
  if (response.status !== 503) return false;
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown };
    };
    return body.error?.code === "ACCOUNT_DATA_DELETION_INCOMPLETE";
  } catch {
    return false;
  }
}

export function AccountDataDeletionDialog({
  open,
  onClose,
  onDeleted = () => window.location.reload(),
  restoreFocus,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
  restoreFocus?: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inProgress = useRef(false);
  const modalCleanupRef = useRef<(() => void) | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const authorizeDeletion = useReverification(requestDeletionAuthorization);

  useEffect(() => {
    if (!open) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overlay = overlayRef.current;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== overlay,
    );
    const previousInert = background.map((element) => ({
      element,
      inert: Boolean(element.inert),
    }));
    for (const { element } of previousInert) element.inert = true;

    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      for (const state of previousInert) state.element.inert = state.inert;
      if (previousFocus?.isConnected) previousFocus.focus();
      else restoreFocus?.();
    };
    modalCleanupRef.current = restore;
    inputRef.current?.focus();

    return () => {
      if (modalCleanupRef.current === restore) modalCleanupRef.current = null;
      restore();
    };
  }, [open, restoreFocus]);

  if (!open || typeof document === "undefined") return null;

  async function handleDelete() {
    if (
      inProgress.current ||
      (!retryable && phrase !== confirmationPhrase)
    ) {
      return;
    }

    inProgress.current = true;
    setBusy(true);
    setIsError(false);
    setStatus("Deleting your cloud Mood & Moments data…");
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      deletionTimeoutMilliseconds,
    );

    try {
      await waitForAbort(authorizeDeletion(controller.signal), controller.signal);
      const response = await fetch("/api/account/data", {
        body: JSON.stringify({ confirmation: confirmationPhrase }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
        signal: controller.signal,
      });
      if (response.status === 204) {
        setStatus("Your cloud Mood & Moments data was deleted.");
        closeDialog(true);
        onDeleted();
        return;
      }

      const incomplete = await isIncompleteDeletionResponse(response);
      setRetryable(true);
      setIsError(true);
      setStatus(
        incomplete
          ? "Your cloud data deletion is incomplete. Retry cleanup safely."
          : "Your cloud data deletion could not be verified. Retry cleanup safely.",
      );
    } catch (error) {
      if (isReverificationCancelledError(error)) {
        setStatus("Cloud data deletion cancelled.");
      } else {
        setRetryable(true);
        setIsError(true);
        setStatus(
          "Your cloud data deletion could not be verified. Retry cleanup safely.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      inProgress.current = false;
      setBusy(false);
    }
  }

  function closeDialog(force = false) {
    if (inProgress.current && !force) return;
    modalCleanupRef.current?.();
    modalCleanupRef.current = null;
    onClose();
  }

  function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hidden);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
      ref={overlayRef}
    >
      <section
        aria-describedby="delete-cloud-data-description"
        aria-labelledby="delete-cloud-data-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-rose/30 bg-elevated p-6 shadow-2xl sm:p-8"
        onKeyDown={trapDialogFocus}
        ref={dialogRef}
        role="dialog"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose">
          Irreversible action
        </p>
        <h2
          className="mt-3 font-display text-3xl text-primary"
          id="delete-cloud-data-title"
        >
          Delete cloud data
        </h2>
        <div
          className="mt-4 space-y-3 text-sm leading-6 text-secondary"
          id="delete-cloud-data-description"
        >
          <p>
            This permanently deletes your cloud Moments and their private images.
          </p>
          <p>
            Your Clerk account stays active. Static examples and browser-local
            legacy Moments are not deleted.
          </p>
        </div>

        <label className="mt-6 block text-sm font-medium text-primary">
          Type <span className="font-mono text-rose">DELETE MY DATA</span> to
          confirm
          <input
            autoComplete="off"
            className="mt-2 min-h-12 w-full rounded-lg border border-white/10 bg-background/70 px-4 text-primary outline-none transition focus:border-rose/60 focus:ring-2 focus:ring-rose/20"
            disabled={busy || retryable}
            onChange={(event) => setPhrase(event.target.value)}
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={phrase}
          />
        </label>

        {status ? (
          <p
            aria-live={isError ? "assertive" : "polite"}
            className={`mt-4 text-sm ${isError ? "text-rose" : "text-secondary"}`}
            role={isError ? "alert" : "status"}
          >
            {status}
          </p>
        ) : null}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="button-secondary min-h-12 px-5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => closeDialog()}
            type="button"
          >
            Keep my data
          </button>
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-sm border border-rose/50 bg-rose/15 px-5 text-sm font-semibold text-primary transition hover:bg-rose/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy || (!retryable && phrase !== confirmationPhrase)}
            onClick={() => void handleDelete()}
            type="button"
          >
            {retryable ? "Retry cleanup" : "Delete cloud data"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
