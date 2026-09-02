import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import { canonicalLegacyMomentValue, sha256Text } from "@/lib/legacy-moment-import";
import {
  LEGACY_IMPORT_STATE_KEY,
  LEGACY_MOMENTS_STORAGE_KEY,
  LocalStorageLegacyMomentSource,
} from "@/repositories/local-storage-legacy-moment-source";

import { LegacyMomentImport } from "./legacy-moment-import";

const validPng = "data:image/png;base64,iVBORw0KGgo=";

const legacyRecords = [
  {
    id: "legacy-with-image",
    date: "Aug 28, 2026",
    dateTime: "2026-08-28T09:15:30Z",
    time: "9:15 AM",
    mood: "calm",
    title: "A quiet beginning",
    excerpt: "The room felt peaceful.",
    image: { src: validPng, alt: "A quiet room." },
  },
  {
    id: "legacy-broken-image",
    date: "Aug 27, 2026",
    dateTime: "2026-08-27T18:05:00Z",
    time: "6:05 PM",
    mood: "loved",
    title: "Still worth keeping",
    excerpt: "The image is broken, but the memory is not.",
    image: { src: "data:image/gif;base64,R0lGODlh", alt: "Unsupported." },
  },
  {
    id: "legacy-malformed",
    dateTime: "not-a-date",
    mood: "calm",
    title: "Cannot be imported",
    excerpt: "This record should be skipped.",
  },
];

function momentFor(sourceId: string): Moment {
  const source = legacyRecords.find((record) => record.id === sourceId)!;
  const id =
    sourceId === "legacy-with-image"
      ? "00000000-0000-4000-8000-000000000001"
      : "00000000-0000-4000-8000-000000000002";
  return {
    id,
    revision: 1,
    date: source.date ?? "Aug 27, 2026",
    dateTime: source.dateTime,
    time: source.time ?? "6:05 PM",
    mood: source.mood as Moment["mood"],
    title: source.title,
    excerpt: source.excerpt,
    ...(sourceId === "legacy-with-image"
      ? {
          image: {
            src: `/api/moments/${id}/image`,
            alt: `${source.title} moment image.`,
          },
        }
      : {}),
  };
}

async function responseFor(form: FormData) {
  const sourceId = String(form.get("sourceId"));
  const sourceHash = await sha256Text(
    canonicalLegacyMomentValue({
      sourceId,
      title: String(form.get("title")),
      description: String(form.get("description")),
      mood: String(form.get("mood")) as Moment["mood"],
      date: String(form.get("date")),
      time: String(form.get("time")),
    }),
  );
  return new Response(
    JSON.stringify({
      result: {
        outcome: "created",
        imageOutcome: form.get("image") ? "uploaded" : "not_provided",
        sourceId,
        sourceHash,
        moment: momentFor(sourceId),
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
}

describe("LegacyMomentImport", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify(legacyRecords),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not inspect browser-local data until the signed-in user asks", async () => {
    const storageRead = vi.spyOn(Storage.prototype, "getItem");

    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );

    expect(storageRead).not.toHaveBeenCalled();
    expect(screen.queryByText("A quiet beginning")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );

    expect(await screen.findByText("2 ready to import")).not.toBeNull();
    expect(screen.getByText("1 skipped")).not.toBeNull();
    expect(screen.getByText("A quiet beginning")).not.toBeNull();
    expect(screen.getByText("Still worth keeping")).not.toBeNull();
    expect(
      screen.getByText("Will import without its unsupported image."),
    ).not.toBeNull();
    expect(screen.getByText("Cannot be imported")).not.toBeNull();
  });

  it("imports sequentially, reports partial failure, and retries safely", async () => {
    const onImportedMoment = vi.fn();
    let failedOnce = false;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      if (form.get("sourceId") === "legacy-broken-image" && !failedOnce) {
        failedOnce = true;
        return new Response(
          JSON.stringify({
            error: { code: "INTERNAL_ERROR", message: "Try again." },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return responseFor(form);
    });
    vi.stubGlobal("fetch", fetcher);
    render(
      <LegacyMomentImport
        userId="user_a"
        onImportedMoment={onImportedMoment}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("2 ready to import");

    fireEvent.click(screen.getByRole("button", { name: "Import 2 Moments" }));

    expect(await screen.findByText("1 imported, 1 failed, 1 skipped.")).not.toBeNull();
    expect(onImportedMoment).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)).not.toContain(
      "user_a",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry 1 failed Moment" }));

    expect(await screen.findByText("2 imported, 0 failed, 1 skipped.")).not.toBeNull();
    expect(onImportedMoment).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const retryBody = fetcher.mock.calls[2]![1]!.body as FormData;
    expect(retryBody.get("sourceId")).toBe("legacy-broken-image");
    expect(retryBody.get("image")).toBeNull();
    expect(
      screen.getByText("Imported without image; kept locally for review."),
    ).not.toBeNull();
  });

  it("blocks a different Clerk account from importing a bound dataset", async () => {
    const source = new LocalStorageLegacyMomentSource(window.localStorage);
    await source.recordConfirmedImport("user_a", {
      cloudMomentId: "00000000-0000-4000-8000-000000000001",
      imageComplete: true,
      localRecordHash: "b".repeat(64),
      sourceHash: "a".repeat(64),
      sourceId: "legacy-with-image",
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <LegacyMomentImport userId="user_b" onImportedMoment={vi.fn()} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "Legacy Moments belong to another account",
      }),
    ).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("blocks another account with an active claim before any API request", async () => {
    const claimingSource = new LocalStorageLegacyMomentSource(
      window.localStorage,
      { createClaimId: () => "claim-user-a" },
    );
    await claimingSource.acquireClaim("user_a");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <LegacyMomentImport userId="user_b" onImportedMoment={vi.fn()} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "Legacy Moment import in progress",
      }),
    ).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("recognizes an active claim held by another tab of the same account", async () => {
    const claimingSource = new LocalStorageLegacyMomentSource(
      window.localStorage,
      { createClaimId: () => "claim-user-a" },
    );
    await claimingSource.acquireClaim("user_a");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );

    expect(
      await screen.findByText(
        "This account already has a legacy import in progress in another tab.",
      ),
    ).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("writes and verifies a claim before sending the first import request", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (fetcher.mock.calls.length === 1) {
        const state = JSON.parse(
          window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)!,
        ) as { claim?: { claimId: string } };
        expect(state.claim?.claimId).toBeTruthy();
      }
      return responseFor(init?.body as FormData);
    });
    vi.stubGlobal("fetch", fetcher);
    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("2 ready to import");

    fireEvent.click(screen.getByRole("button", { name: "Import 2 Moments" }));

    await screen.findByText("2 imported, 0 failed, 1 skipped.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const state = JSON.parse(
      window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)!,
    ) as { claim?: unknown; accountFingerprint: string };
    expect(state.claim).toBeUndefined();
    expect(state.accountFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("releases its claim when every import request fails safely", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([legacyRecords[0]]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "INTERNAL_ERROR", message: "Try again." },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("1 ready to import");

    fireEvent.click(screen.getByRole("button", { name: "Import 1 Moment" }));

    await screen.findByText("0 imported, 1 failed, 0 skipped.");
    expect(window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)).toBeNull();
  });

  it("retains the claim after cloud success when local finalization fails", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([legacyRecords[0]]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        responseFor(init?.body as FormData),
      ),
    );
    const originalSetItem = Storage.prototype.setItem;
    let importStateWrites = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === LEGACY_IMPORT_STATE_KEY) {
        importStateWrites += 1;
        if (importStateWrites === 2) {
          throw new DOMException("blocked", "QuotaExceededError");
        }
      }
      return originalSetItem.call(this, key, value);
    });
    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("1 ready to import");

    fireEvent.click(screen.getByRole("button", { name: "Import 1 Moment" }));

    expect(
      await screen.findByText(
        "The cloud import succeeded, but its local association could not be finalized. This browser remains locked to this pending import for safety.",
      ),
    ).not.toBeNull();
    const state = JSON.parse(
      window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)!,
    ) as { claim?: { claimId: string } };
    expect(state.claim?.claimId).toBeTruthy();
    const observer = new LocalStorageLegacyMomentSource(window.localStorage);
    await expect(observer.associationFor("user_b")).resolves.toBe(
      "pending-other",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Retry 1 failed Moment" }),
    );

    await screen.findByText("1 imported, 0 failed, 0 skipped.");
    await expect(observer.associationFor("user_a")).resolves.toBe("current");
    await expect(observer.associationFor("user_b")).resolves.toBe("other");
  });

  it("reacts to a cross-tab storage claim and blocks the reviewed import", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("2 ready to import");
    const otherTab = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-user-b",
    });
    await otherTab.acquireClaim("user_b");

    window.dispatchEvent(
      new StorageEvent("storage", { key: LEGACY_IMPORT_STATE_KEY }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "Legacy Moment import in progress",
      }),
    ).not.toBeNull();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Import 2 Moments" }),
      ).toBeNull(),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows only one account to reach the API when two tabs import concurrently", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([legacyRecords[0]]),
    );
    let continueRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolve) => {
      continueRequest = resolve;
    });
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      await requestGate;
      return responseFor(init?.body as FormData);
    });
    vi.stubGlobal("fetch", fetcher);
    const first = render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );
    const second = render(
      <LegacyMomentImport userId="user_b" onImportedMoment={vi.fn()} />,
    );
    fireEvent.click(
      within(first.container).getByRole("button", {
        name: "Review legacy Moments",
      }),
    );
    fireEvent.click(
      within(second.container).getByRole("button", {
        name: "Review legacy Moments",
      }),
    );
    await waitFor(() => {
      expect(
        within(first.container).getByText("1 ready to import"),
      ).not.toBeNull();
      expect(
        within(second.container).getByText("1 ready to import"),
      ).not.toBeNull();
    });

    fireEvent.click(
      within(first.container).getByRole("button", { name: "Import 1 Moment" }),
    );
    fireEvent.click(
      within(second.container).getByRole("button", { name: "Import 1 Moment" }),
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("alert", {
        name: "Legacy Moment import in progress",
      }),
    ).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    continueRequest?.();
    await screen.findByText("1 imported, 0 failed, 0 skipped.");
  });

  it("cleans up only fully represented imports after inline confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        responseFor(init?.body as FormData),
      ),
    );
    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("2 ready to import");
    fireEvent.click(screen.getByRole("button", { name: "Import 2 Moments" }));
    await screen.findByText("2 imported, 0 failed, 1 skipped.");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove 1 fully imported local Moment",
      }),
    );
    const confirmation = screen.getByRole("group", {
      name: "Confirm local Moment cleanup",
    });
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Remove local copy" }),
    );

    expect(await screen.findByText("Removed 1 local Moment; 2 preserved.")).not.toBeNull();
    const remaining = JSON.parse(
      window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)!,
    ) as { id: string }[];
    expect(remaining.map((item) => item.id)).toEqual([
      "legacy-broken-image",
      "legacy-malformed",
    ]);
  });

  it("keeps a different local image retryable and ineligible for cleanup", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const response = await responseFor(form);
      const body = await response.json();

      if (form.get("sourceId") === "legacy-with-image") {
        body.result.outcome = "image_mismatch";
        body.result.imageOutcome = "mismatch";
      }

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    render(
      <LegacyMomentImport userId="user_a" onImportedMoment={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review legacy Moments" }),
    );
    await screen.findByText("2 ready to import");

    fireEvent.click(screen.getByRole("button", { name: "Import 2 Moments" }));

    expect(await screen.findByText("1 imported, 1 failed, 1 skipped.")).not.toBeNull();
    expect(screen.getByText("Cloud image differs; kept locally for retry.")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Retry 1 failed Moment" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Remove 1 fully imported local Moment",
      }),
    ).toBeNull();
    expect(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)).toContain(
      "legacy-with-image",
    );

    const state = JSON.parse(
      window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)!,
    ) as { receipts: Record<string, { imageComplete: boolean }> };
    expect(state.receipts["legacy-with-image"]?.imageComplete).toBe(false);
  });
});
