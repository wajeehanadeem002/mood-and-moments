import { describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import { MomentImportConflictError } from "@/repositories/supabase-moment-repository";

import {
  AuthenticatedMomentImportService,
  LegacyImportSourceConflictError,
  MomentImportLifecycleError,
} from "./authenticated-moment-import-service";

const sourceHash = "a".repeat(64);
const moment: Moment = {
  id: "00000000-0000-4000-8000-000000000001",
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:30",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful.",
};

function record(overrides: Record<string, unknown> = {}) {
  return {
    moment,
    imagePath: null,
    sourceId: "legacy-1",
    sourceHash,
    ...overrides,
  };
}

function stores() {
  return {
    moments: {
      createImported: vi.fn().mockResolvedValue(record()),
      deleteIncompleteImport: vi.fn().mockResolvedValue(true),
      findImportRecord: vi.fn().mockResolvedValue(null),
      updateWithImagePath: vi.fn().mockImplementation(async (value: Moment) => ({
        ...value,
        image: {
          src: `/api/moments/${value.id}/image`,
          alt: `${value.title} moment image.`,
        },
      })),
    },
    images: {
      remove: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const source = { sourceHash, sourceId: "legacy-1", time: "09:15:30" };

describe("AuthenticatedMomentImportService", () => {
  it("creates a text-only imported Moment with a server-owned identity", async () => {
    const store = stores();
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );

    await expect(service.import(moment, source, null)).resolves.toEqual({
      outcome: "created",
      imageOutcome: "not_provided",
      moment,
      sourceHash,
      sourceId: "legacy-1",
    });
    expect(store.moments.createImported).toHaveBeenCalledWith(moment, source);
    expect(store.images.upsert).not.toHaveBeenCalled();
  });

  it("returns an existing matching import without changing cloud data", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(record());
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );

    await expect(service.import(moment, source, null)).resolves.toMatchObject({
      outcome: "already_imported",
      imageOutcome: "not_provided",
      moment,
    });
    expect(store.moments.createImported).not.toHaveBeenCalled();
  });

  it("rejects a changed source id without updating the previous import", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(
      record({ sourceHash: "b".repeat(64) }),
    );
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );

    await expect(service.import(moment, source, null)).rejects.toBeInstanceOf(
      LegacyImportSourceConflictError,
    );
    expect(store.moments.createImported).not.toHaveBeenCalled();
  });

  it("recovers a concurrent duplicate insert by re-reading the durable import", async () => {
    const store = stores();
    store.moments.createImported.mockRejectedValue(new MomentImportConflictError());
    store.moments.findImportRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record());
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );

    await expect(service.import(moment, source, null)).resolves.toMatchObject({
      outcome: "already_imported",
      moment,
    });
    expect(store.moments.findImportRecord).toHaveBeenCalledTimes(2);
  });

  it("uploads a valid image to the stable authenticated path", async () => {
    const store = stores();
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );
    const image = new File(["image"], "legacy.png", { type: "image/png" });

    await expect(service.import(moment, source, image)).resolves.toMatchObject({
      outcome: "created",
      imageOutcome: "uploaded",
      moment: { image: { src: `/api/moments/${moment.id}/image` } },
    });
    expect(store.images.upsert).toHaveBeenCalledWith(
      `user_a/${moment.id}/image`,
      image,
    );
    expect(store.moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      `user_a/${moment.id}/image`,
    );
  });

  it("completes an existing text-only import when a repaired image is retried", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(record());
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );
    const image = new File(["image"], "legacy.png", { type: "image/png" });

    await expect(service.import(moment, source, image)).resolves.toMatchObject({
      outcome: "completed_existing",
      imageOutcome: "uploaded",
    });
    expect(store.moments.createImported).not.toHaveBeenCalled();
  });

  it("does not replace an image already confirmed for the import", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(
      record({ imagePath: `user_a/${moment.id}/image` }),
    );
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );
    const image = new File(["new"], "legacy.png", { type: "image/png" });

    await expect(service.import(moment, source, image)).resolves.toMatchObject({
      outcome: "already_imported",
      imageOutcome: "already_present",
    });
    expect(store.images.upsert).not.toHaveBeenCalled();
  });

  it("compensates a new row and object when image linking fails", async () => {
    const store = stores();
    store.moments.updateWithImagePath.mockRejectedValue(new Error("db unavailable"));
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );
    const image = new File(["image"], "legacy.png", { type: "image/png" });

    await expect(service.import(moment, source, image)).rejects.toBeInstanceOf(
      MomentImportLifecycleError,
    );
    expect(store.images.remove).toHaveBeenCalledWith(`user_a/${moment.id}/image`);
    expect(store.moments.deleteIncompleteImport).toHaveBeenCalledWith(moment.id);
  });

  it("preserves a concurrent image completion when another request fails", async () => {
    const store = stores();
    const imagePath = `user_a/${moment.id}/image`;
    const completedMoment = {
      ...moment,
      image: {
        src: `/api/moments/${moment.id}/image`,
        alt: `${moment.title} moment image.`,
      },
    };
    store.moments.updateWithImagePath.mockRejectedValue(
      new Error("request lost its database connection"),
    );
    store.moments.deleteIncompleteImport.mockResolvedValue(false);
    store.moments.findImportRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        record({ imagePath, moment: completedMoment }),
      );
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );

    await expect(
      service.import(
        moment,
        source,
        new File(["image"], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({
      outcome: "already_imported",
      imageOutcome: "already_present",
      moment: completedMoment,
    });
    expect(store.images.remove).not.toHaveBeenCalled();
  });

  it("waits for an in-flight duplicate request to finish linking its image", async () => {
    const store = stores();
    const imagePath = `user_a/${moment.id}/image`;
    const completedMoment = {
      ...moment,
      image: {
        src: `/api/moments/${moment.id}/image`,
        alt: `${moment.title} moment image.`,
      },
    };
    store.moments.updateWithImagePath.mockRejectedValue(
      new Error("concurrent Storage write lost"),
    );
    store.moments.deleteIncompleteImport.mockResolvedValue(false);
    store.moments.findImportRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(
        record({ imagePath, moment: completedMoment }),
      );
    const pause = vi.fn().mockResolvedValue(undefined);
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
      pause,
    );

    await expect(
      service.import(
        moment,
        source,
        new File(["image"], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({
      outcome: "already_imported",
      imageOutcome: "already_present",
      moment: completedMoment,
    });
    expect(pause).toHaveBeenCalled();
    expect(store.images.remove).not.toHaveBeenCalled();
  });

  it("reports compensation failures without hiding them", async () => {
    const store = stores();
    store.images.upsert.mockRejectedValue(new Error("storage unavailable"));
    store.moments.deleteIncompleteImport.mockRejectedValue(
      new Error("delete unavailable"),
    );
    const service = new AuthenticatedMomentImportService(
      store.moments,
      store.images,
      "user_a",
    );

    const action = service.import(
      moment,
      source,
      new File(["image"], "legacy.png", { type: "image/png" }),
    );
    await expect(action).rejects.toMatchObject({ cleanupFailures: [expect.any(Error)] });
  });
});
