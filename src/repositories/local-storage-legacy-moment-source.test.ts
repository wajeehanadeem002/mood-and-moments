import { beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Text } from "@/lib/legacy-moment-import";

import {
  LEGACY_IMPORT_STATE_KEY,
  LEGACY_MOMENTS_STORAGE_KEY,
  LocalStorageLegacyMomentSource,
} from "./local-storage-legacy-moment-source";

const first = {
  id: "legacy-1",
  dateTime: "2026-08-28T09:15:30",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful.",
};

const second = {
  id: "legacy-2",
  dateTime: "2026-08-29T19:05:00",
  mood: "loved",
  title: "A call worth keeping",
  excerpt: "We laughed for a long time.",
};

const confirmedReceipt = {
  cloudMomentId: "cloud-1",
  imageComplete: true,
  localRecordHash: "b".repeat(64),
  sourceHash: "a".repeat(64),
  sourceId: "legacy-1",
};

describe("LocalStorageLegacyMomentSource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("does not access storage until inspect is explicitly called", async () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const source = new LocalStorageLegacyMomentSource(window.localStorage);

    expect(read).not.toHaveBeenCalled();
    await source.inspect();
    expect(read).toHaveBeenCalledWith(LEGACY_MOMENTS_STORAGE_KEY);
  });

  it("preserves malformed source data byte-for-byte", async () => {
    window.localStorage.setItem(LEGACY_MOMENTS_STORAGE_KEY, "{not-json");
    const source = new LocalStorageLegacyMomentSource(window.localStorage);

    await expect(source.inspect()).resolves.toEqual({
      kind: "error",
      reason: "INVALID_JSON",
    });
    expect(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)).toBe(
      "{not-json",
    );
  });

  it("binds the dataset only after recording a confirmed cloud result", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([first]),
    );
    const source = new LocalStorageLegacyMomentSource(window.localStorage);
    const inspection = await source.inspect();
    if (inspection.kind !== "ready") throw new Error("Expected ready source");

    await expect(source.associationFor("user-a")).resolves.toBe("unbound");
    await source.recordConfirmedImport("user-a", {
      cloudMomentId: "cloud-1",
      imageComplete: true,
      localRecordHash: inspection.candidates[0]!.localRecordHash,
      sourceHash: inspection.candidates[0]!.sourceHash,
      sourceId: "legacy-1",
    });

    await expect(source.associationFor("user-a")).resolves.toBe("current");
    await expect(source.associationFor("user-b")).resolves.toBe("other");
    expect(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)).toBe(
      JSON.stringify([first]),
    );
  });

  it("acquires a fingerprinted pending claim before binding the dataset", async () => {
    const source = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-a",
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });

    await expect(source.acquireClaim("user-a")).resolves.toEqual({
      status: "acquired",
      claimId: "claim-a",
      expiresAt: "2026-08-30T10:02:00.000Z",
    });
    await expect(source.associationFor("user-a")).resolves.toBe(
      "pending-current",
    );
    await expect(source.associationFor("user-b")).resolves.toBe(
      "pending-other",
    );
    expect(window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)).not.toContain(
      "user-a",
    );
  });

  it("blocks another account and another tab of the same account while a claim is active", async () => {
    const first = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-a",
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });
    const second = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-b",
      now: () => new Date("2026-08-30T10:00:01.000Z"),
    });
    await first.acquireClaim("user-a");

    await expect(second.acquireClaim("user-b")).resolves.toEqual({
      status: "blocked",
      association: "pending-other",
    });
    await expect(second.acquireClaim("user-a")).resolves.toEqual({
      status: "blocked",
      association: "pending-current",
    });
  });

  it("reclaims an expired claim without allowing the old holder to finalize or release it", async () => {
    let now = new Date("2026-08-30T10:00:00.000Z");
    const first = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-old",
      now: () => now,
    });
    const second = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-new",
      now: () => now,
    });
    await first.acquireClaim("user-a");
    now = new Date("2026-08-30T10:02:01.000Z");

    await expect(second.acquireClaim("user-b")).resolves.toEqual({
      status: "acquired",
      claimId: "claim-new",
      expiresAt: "2026-08-30T10:04:01.000Z",
    });
    await expect(
      first.recordConfirmedImport("user-a", confirmedReceipt, "claim-old"),
    ).rejects.toThrow("pending claim is no longer active");
    await expect(first.releaseClaim("user-a", "claim-old")).resolves.toBe(
      false,
    );
    await expect(second.associationFor("user-b")).resolves.toBe(
      "pending-current",
    );
  });

  it("releases only a matching active claim after a safe failure", async () => {
    const source = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-a",
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });
    await source.acquireClaim("user-a");

    await expect(source.releaseClaim("user-a", "wrong-claim")).resolves.toBe(
      false,
    );
    await expect(source.associationFor("user-a")).resolves.toBe(
      "pending-current",
    );
    await expect(source.releaseClaim("user-a", "claim-a")).resolves.toBe(
      true,
    );
    await expect(source.associationFor("user-a")).resolves.toBe("unbound");
  });

  it("atomically finalizes the matching claim with the first cloud receipt", async () => {
    const source = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-a",
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });
    await source.acquireClaim("user-a");

    await source.recordConfirmedImport(
      "user-a",
      confirmedReceipt,
      "claim-a",
    );

    await expect(source.associationFor("user-a")).resolves.toBe("current");
    await expect(source.associationFor("user-b")).resolves.toBe("other");
    const state = JSON.parse(
      window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)!,
    ) as { claim?: unknown; bindingClaimId?: string };
    expect(state.claim).toBeUndefined();
    expect(state.bindingClaimId).toBe("claim-a");
  });

  it("does not report finalization when the confirmed state was not persisted", async () => {
    const source = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-a",
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });
    await source.acquireClaim("user-a");
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === LEGACY_IMPORT_STATE_KEY) return;
      return originalSetItem.call(this, key, value);
    });

    await expect(
      source.recordConfirmedImport(
        "user-a",
        confirmedReceipt,
        "claim-a",
      ),
    ).rejects.toThrow("confirmation could not be verified");
    await expect(source.associationFor("user-a")).resolves.toBe(
      "pending-current",
    );
  });

  it("treats implausible claim timestamps as corrupt instead of trusting them", async () => {
    const accountFingerprint = await sha256Text("user-a");
    window.localStorage.setItem(
      LEGACY_IMPORT_STATE_KEY,
      JSON.stringify({
        version: 1,
        accountFingerprint,
        receipts: {},
        claim: {
          accountFingerprint,
          claimId: "claim-a",
          acquiredAt: "2026-08-30T11:00:00.000Z",
          expiresAt: "2026-08-30T12:00:00.000Z",
        },
      }),
    );
    const source = new LocalStorageLegacyMomentSource(window.localStorage, {
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });

    await expect(source.associationFor("user-a")).resolves.toBe("corrupt");
    await expect(source.acquireClaim("user-a")).resolves.toEqual({
      status: "blocked",
      association: "corrupt",
    });
  });

  it("keeps the pre-claim version-one association format compatible", async () => {
    const accountFingerprint = await sha256Text("user-a");
    window.localStorage.setItem(
      LEGACY_IMPORT_STATE_KEY,
      JSON.stringify({
        version: 1,
        accountFingerprint,
        receipts: {
          "legacy-1": {
            ...confirmedReceipt,
            importedAt: "2026-08-30T09:00:00.000Z",
          },
        },
      }),
    );
    const source = new LocalStorageLegacyMomentSource(window.localStorage);

    await expect(source.associationFor("user-a")).resolves.toBe("current");
    await expect(source.associationFor("user-b")).resolves.toBe("other");
  });

  it("allows only one of two concurrent accounts to acquire the unbound dataset", async () => {
    const first = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-a",
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });
    const second = new LocalStorageLegacyMomentSource(window.localStorage, {
      createClaimId: () => "claim-b",
      now: () => new Date("2026-08-30T10:00:00.000Z"),
    });

    const outcomes = await Promise.all([
      first.acquireClaim("user-a"),
      second.acquireClaim("user-b"),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "acquired"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "blocked"),
    ).toHaveLength(1);
  });

  it("does not overwrite a corrupt association marker", async () => {
    window.localStorage.setItem(LEGACY_IMPORT_STATE_KEY, "{not-json");
    const source = new LocalStorageLegacyMomentSource(window.localStorage);

    await expect(
      source.recordConfirmedImport("user-a", {
        cloudMomentId: "cloud-1",
        imageComplete: true,
        localRecordHash: "b".repeat(64),
        sourceHash: "a".repeat(64),
        sourceId: "legacy-1",
      }),
    ).rejects.toThrow("association cannot be verified");
    expect(window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)).toBe(
      "{not-json",
    );
  });

  it("removes only confirmed exact matches and preserves changed or failed items", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([first, second]),
    );
    const source = new LocalStorageLegacyMomentSource(window.localStorage);
    const inspection = await source.inspect();
    if (inspection.kind !== "ready") throw new Error("Expected ready source");

    const firstCandidate = inspection.candidates[0]!;
    await source.recordConfirmedImport("user-a", {
      cloudMomentId: "cloud-1",
      imageComplete: true,
      localRecordHash: firstCandidate.localRecordHash,
      sourceHash: firstCandidate.sourceHash,
      sourceId: firstCandidate.sourceId,
    });

    const changedFirst = { ...first, title: "Changed in another tab" };
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([changedFirst, second]),
    );

    await expect(
      source.cleanupConfirmed("user-a", [
        {
          localRecordHash: firstCandidate.localRecordHash,
          sourceHash: firstCandidate.sourceHash,
          sourceId: firstCandidate.sourceId,
        },
      ]),
    ).resolves.toEqual({ removed: 0, preserved: 2 });
    expect(JSON.parse(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)!)).toEqual([
      changedFirst,
      second,
    ]);
  });

  it("preserves a local record when only its image changed concurrently", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([first]),
    );
    const source = new LocalStorageLegacyMomentSource(window.localStorage);
    const inspection = await source.inspect();
    if (inspection.kind !== "ready") throw new Error("Expected ready source");
    const candidate = inspection.candidates[0]!;
    await source.recordConfirmedImport("user-a", {
      cloudMomentId: "cloud-1",
      imageComplete: true,
      localRecordHash: candidate.localRecordHash,
      sourceHash: candidate.sourceHash,
      sourceId: candidate.sourceId,
    });
    const changedImage = {
      ...first,
      image: {
        src: "data:image/png;base64,iVBORw0KGgo=",
        alt: "Added in another tab.",
      },
    };
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([changedImage]),
    );

    await expect(
      source.cleanupConfirmed("user-a", [
        {
          localRecordHash: candidate.localRecordHash,
          sourceHash: candidate.sourceHash,
          sourceId: candidate.sourceId,
        },
      ]),
    ).resolves.toEqual({ removed: 0, preserved: 1 });
    expect(
      JSON.parse(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)!),
    ).toEqual([changedImage]);
  });

  it("removes fully represented records while retaining image-incomplete records", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([first, second]),
    );
    const source = new LocalStorageLegacyMomentSource(window.localStorage);
    const inspection = await source.inspect();
    if (inspection.kind !== "ready") throw new Error("Expected ready source");

    for (const candidate of inspection.candidates) {
      await source.recordConfirmedImport("user-a", {
        cloudMomentId: `cloud-${candidate.sourceId}`,
        imageComplete: candidate.sourceId === "legacy-1",
        localRecordHash: candidate.localRecordHash,
        sourceHash: candidate.sourceHash,
        sourceId: candidate.sourceId,
      });
    }

    await expect(
      source.cleanupConfirmed("user-a", [
        {
          sourceHash: inspection.candidates[0]!.sourceHash,
          localRecordHash: inspection.candidates[0]!.localRecordHash,
          sourceId: "legacy-1",
        },
      ]),
    ).resolves.toEqual({ removed: 1, preserved: 1 });
    expect(JSON.parse(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)!)).toEqual([
      second,
    ]);
    expect(window.localStorage.getItem(LEGACY_IMPORT_STATE_KEY)).not.toBeNull();
  });

  it("requires an image-complete confirmed receipt before local cleanup", async () => {
    window.localStorage.setItem(
      LEGACY_MOMENTS_STORAGE_KEY,
      JSON.stringify([first]),
    );
    const source = new LocalStorageLegacyMomentSource(window.localStorage);
    const inspection = await source.inspect();
    if (inspection.kind !== "ready") throw new Error("Expected ready source");
    const candidate = inspection.candidates[0]!;
    await source.recordConfirmedImport("user-a", {
      cloudMomentId: "cloud-1",
      imageComplete: false,
      localRecordHash: candidate.localRecordHash,
      sourceHash: candidate.sourceHash,
      sourceId: candidate.sourceId,
    });

    await expect(
      source.cleanupConfirmed("user-a", [
        {
          localRecordHash: candidate.localRecordHash,
          sourceHash: candidate.sourceHash,
          sourceId: candidate.sourceId,
        },
      ]),
    ).resolves.toEqual({ removed: 0, preserved: 1 });
    expect(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)).toBe(
      JSON.stringify([first]),
    );
  });

  it("reports cleanup write failures without altering the source", async () => {
    const raw = JSON.stringify([first]);
    window.localStorage.setItem(LEGACY_MOMENTS_STORAGE_KEY, raw);
    const source = new LocalStorageLegacyMomentSource(window.localStorage);
    const inspection = await source.inspect();
    if (inspection.kind !== "ready") throw new Error("Expected ready source");
    const candidate = inspection.candidates[0]!;
    await source.recordConfirmedImport("user-a", {
      cloudMomentId: "cloud-1",
      imageComplete: true,
      localRecordHash: candidate.localRecordHash,
      sourceHash: candidate.sourceHash,
      sourceId: candidate.sourceId,
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    await expect(
      source.cleanupConfirmed("user-a", [
        {
          localRecordHash: candidate.localRecordHash,
          sourceHash: candidate.sourceHash,
          sourceId: candidate.sourceId,
        },
      ]),
    ).rejects.toThrow("Legacy cleanup could not be saved.");
    expect(window.localStorage.getItem(LEGACY_MOMENTS_STORAGE_KEY)).toBe(raw);
  });
});
