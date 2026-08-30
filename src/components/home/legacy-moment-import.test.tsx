import { fireEvent, render, screen, within } from "@testing-library/react";
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
});
