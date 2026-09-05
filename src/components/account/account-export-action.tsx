"use client";

import { UserButton, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AccountDataDeletionDialog } from "@/components/account/account-data-deletion-action";

type ExportAuthorizationResult =
  | { authorized: true }
  | { clerk_error: unknown };

type ExportDownload = {
  blob: Blob;
  fileName: string;
};

const exportDownloadTimeoutMilliseconds = 120_000;
const fallbackExportFileName = "mood-and-moments-export.zip";

function isClerkReverificationHint(
  value: unknown,
): value is { clerk_error: unknown } {
  return Boolean(
    value && typeof value === "object" && "clerk_error" in value,
  );
}

async function requestExportAuthorization(): Promise<ExportAuthorizationResult> {
  const response = await fetch("/api/account/export", {
    cache: "no-store",
    method: "POST",
  });

  if (response.ok) return { authorized: true };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Account export authorization failed.");
  }

  if (isClerkReverificationHint(body)) return body;
  throw new Error("Account export authorization failed.");
}

async function isCompleteZip(blob: Blob): Promise<boolean> {
  if (blob.size < 22) return false;

  const endOffset = blob.size - 22;
  const end = new DataView(await blob.slice(endOffset).arrayBuffer());
  const entriesOnDisk = end.getUint16(8, true);
  const totalEntries = end.getUint16(10, true);
  const centralDirectorySize = end.getUint32(12, true);
  const centralDirectoryOffset = end.getUint32(16, true);

  if (
    end.getUint32(0, true) !== 0x06054b50 ||
    end.getUint16(4, true) !== 0 ||
    end.getUint16(6, true) !== 0 ||
    entriesOnDisk !== totalEntries ||
    end.getUint16(20, true) !== 0 ||
    centralDirectoryOffset + centralDirectorySize !== endOffset
  ) {
    return false;
  }

  if (totalEntries === 0) return centralDirectorySize === 0;
  if (centralDirectorySize < 46) return false;

  const centralHeader = new DataView(
    await blob
      .slice(centralDirectoryOffset, centralDirectoryOffset + 4)
      .arrayBuffer(),
  );
  return (
    centralHeader.byteLength === 4 &&
    centralHeader.getUint32(0, true) === 0x02014b50
  );
}

async function requestExportDownload(
  signal: AbortSignal,
): Promise<ExportDownload> {
  const response = await fetch("/api/account/export", {
    cache: "no-store",
    method: "GET",
    signal,
  });

  if (!response.ok) {
    throw new Error("Account export download failed.");
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/zip") {
    throw new Error("Account export returned an invalid media type.");
  }

  const blob = await response.blob();
  if (!(await isCompleteZip(blob))) {
    throw new Error("Account export returned an incomplete archive.");
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName =
    /^attachment;\s*filename="(mood-and-moments-export-\d{4}-\d{2}-\d{2}\.zip)"$/i.exec(
      disposition,
    )?.[1] ?? fallbackExportFileName;

  return { blob, fileName };
}

function saveExportDownload(download: ExportDownload) {
  const objectUrl = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.download = download.fileName;
  anchor.href = objectUrl;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function AccountUserButton({
  emphasized = false,
}: {
  emphasized?: boolean;
}) {
  const accountButtonContainer = useRef<HTMLSpanElement>(null);
  const inProgress = useRef(false);
  const isMounted = useRef(true);
  const downloadAbort = useRef<AbortController | null>(null);
  const timeoutId = useRef<number | null>(null);
  const cancellationReason = useRef<"cancelled" | "timeout" | null>(null);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const authorizeExport = useReverification(requestExportAuthorization);
  const restoreAccountButtonFocus = useCallback(() => {
    accountButtonContainer.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus();
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timeoutId.current !== null) window.clearTimeout(timeoutId.current);
      downloadAbort.current?.abort();
    };
  }, []);

  async function handleExport() {
    if (inProgress.current) return;

    inProgress.current = true;
    setIsError(false);
    setStatus("Preparing your data export…");

    try {
      await authorizeExport();
      if (!isMounted.current) return;

      const controller = new AbortController();
      downloadAbort.current = controller;
      cancellationReason.current = null;
      setIsDownloading(true);
      setStatus("Downloading your data export…");
      timeoutId.current = window.setTimeout(() => {
        cancellationReason.current = "timeout";
        controller.abort();
      }, exportDownloadTimeoutMilliseconds);

      const download = await requestExportDownload(controller.signal);
      if (!isMounted.current) return;
      saveExportDownload(download);
      setStatus("Your data export is ready.");
    } catch (error) {
      if (!isMounted.current) return;

      if (isReverificationCancelledError(error)) {
        setStatus("Data export cancelled.");
      } else if (
        isAbortError(error) &&
        cancellationReason.current === "cancelled"
      ) {
        setStatus("Data export cancelled.");
      } else if (
        isAbortError(error) &&
        cancellationReason.current === "timeout"
      ) {
        setIsError(true);
        setStatus("Your data export timed out. Please try again.");
      } else {
        setIsError(true);
        setStatus("Your data export couldn’t be downloaded. Please try again.");
      }
    } finally {
      if (timeoutId.current !== null) {
        window.clearTimeout(timeoutId.current);
        timeoutId.current = null;
      }
      downloadAbort.current = null;
      cancellationReason.current = null;
      inProgress.current = false;
      if (isMounted.current) setIsDownloading(false);
    }
  }

  function handleAction() {
    if (inProgress.current) {
      if (downloadAbort.current) {
        cancellationReason.current = "cancelled";
        downloadAbort.current.abort();
      }
      return;
    }

    void handleExport();
  }

  return (
    <>
      <span className="inline-flex items-center" ref={accountButtonContainer}>
      <UserButton
        appearance={
          emphasized
            ? {
                elements: {
                  avatarBox:
                    "size-10 border border-champagne/30 shadow-[0_0_0_3px_rgba(255,255,255,0.03)]",
                },
              }
            : undefined
        }
      >
        <UserButton.MenuItems>
          <UserButton.Action
            label={isDownloading ? "Cancel data export" : "Export my data"}
            labelIcon={<Download aria-hidden="true" className="size-4" />}
            onClick={handleAction}
          />
          <UserButton.Action
            label="Delete my Mood & Moments data"
            labelIcon={<Trash2 aria-hidden="true" className="size-4" />}
            onClick={() => setIsDeleteDialogOpen(true)}
          />
        </UserButton.MenuItems>
      </UserButton>
      <span
        className="sr-only"
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}
      >
        {status}
      </span>
      </span>
      {isDeleteDialogOpen ? (
        <AccountDataDeletionDialog
          open
          onClose={() => setIsDeleteDialogOpen(false)}
          restoreFocus={restoreAccountButtonFocus}
        />
      ) : null}
    </>
  );
}
