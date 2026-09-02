import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import {
  MomentImportConflictError,
  MomentVersionConflictError,
  type StoredImportedMomentRecord,
} from "@/repositories/supabase-moment-repository";

import {
  AuthenticatedMomentImportService,
  LegacyImportSourceConflictError,
  MomentImportLifecycleError,
} from "./authenticated-moment-import-service";

const sourceHash = "a".repeat(64);
const imageABytes = new Uint8Array([1, 2, 3, 4]);
const imageBBytes = new Uint8Array([5, 6, 7, 8]);
const imageAHash = createHash("sha256").update(imageABytes).digest("hex");
const generationA = "70000000-0000-4000-8000-000000000001";
const generationB = "70000000-0000-4000-8000-000000000002";
const moment: Moment = {
  id: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:30",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful.",
};
const source = { sourceHash, sourceId: "legacy-1", time: "09:15:30" };

function record(
  overrides: Partial<StoredImportedMomentRecord> = {},
): StoredImportedMomentRecord {
  return {
    moment,
    revision: 1,
    imagePath: null,
    importImageHash: null,
    importSource: "legacy-localstorage-v1",
    sourceId: "legacy-1",
    sourceHash,
    ...overrides,
  };
}

function imageMoment(revision = 2): Moment {
  return {
    ...moment,
    revision,
    image: {
      src: `/api/moments/${moment.id}/image`,
      alt: `${moment.title} moment image.`,
    },
  };
}

function stores() {
  const moments = {
    authorizeImageCandidate: vi.fn().mockResolvedValue(undefined),
    completeImageCleanup: vi.fn().mockResolvedValue(undefined),
    createImported: vi.fn().mockResolvedValue(record()),
    findImportRecord: vi.fn().mockResolvedValue(null),
    updateWithImagePath: vi.fn().mockResolvedValue({
      moment: imageMoment(),
      cleanupPath: null,
    }),
  };
  const images = {
    download: vi.fn().mockResolvedValue({
      body: new Blob([imageABytes], { type: "image/png" }),
      contentType: "image/png",
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
  };

  return { images, moments };
}

function service(
  store: ReturnType<typeof stores>,
  generation = generationA,
) {
  return new AuthenticatedMomentImportService(
    store.moments,
    store.images,
    "user_a",
    async () => undefined,
    () => generation,
  );
}

describe("AuthenticatedMomentImportService", () => {
  it("creates a text-only import without touching Storage", async () => {
    const store = stores();

    await expect(service(store).import(moment, source, null)).resolves.toEqual({
      outcome: "created",
      imageOutcome: "not_provided",
      moment,
      sourceHash,
      sourceId: "legacy-1",
    });
    expect(store.images.upload).not.toHaveBeenCalled();
  });

  it("keeps an existing image when a retry supplies no image", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(
      record({
        moment: imageMoment(),
        revision: 2,
        imagePath: `user_a/${moment.id}/${generationA}`,
        importImageHash: imageAHash,
      }),
    );

    await expect(service(store).import(moment, source, null)).resolves.toMatchObject({
      outcome: "already_imported",
      imageOutcome: "not_provided",
    });
    expect(store.moments.updateWithImagePath).not.toHaveBeenCalled();
    expect(store.images.remove).not.toHaveBeenCalled();
  });

  it("rejects a reused source id whose durable text hash differs", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(
      record({ sourceHash: "b".repeat(64) }),
    );

    await expect(service(store).import(moment, source, null)).rejects.toBeInstanceOf(
      LegacyImportSourceConflictError,
    );
  });

  it("recovers a concurrent duplicate insert by re-reading the durable import", async () => {
    const store = stores();
    store.moments.createImported.mockRejectedValue(new MomentImportConflictError());
    store.moments.findImportRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record());

    await expect(service(store).import(moment, source, null)).resolves.toMatchObject({
      outcome: "already_imported",
      moment,
    });
  });

  it("authorizes and uploads a unique image before linking it by revision", async () => {
    const store = stores();
    const path = `user_a/${moment.id}/${generationA}`;
    const image = new File([imageABytes], "legacy.png", { type: "image/png" });

    await expect(service(store).import(moment, source, image)).resolves.toMatchObject({
      outcome: "created",
      imageOutcome: "uploaded",
      moment: { revision: 2, image: { src: `/api/moments/${moment.id}/image` } },
    });
    expect(store.moments.authorizeImageCandidate).toHaveBeenCalledWith(
      moment.id,
      1,
      path,
    );
    expect(store.images.upload).toHaveBeenCalledWith(path, image);
    expect(store.moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      path,
      imageAHash,
    );
  });

  it("completes an existing text-only import with a repaired image", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(record());

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageBBytes], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({
      outcome: "completed_existing",
      imageOutcome: "uploaded",
    });
  });

  it("confirms an existing image only when metadata and bytes match", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(
      record({
        moment: imageMoment(),
        revision: 2,
        imagePath: `user_a/${moment.id}/${generationA}`,
        importImageHash: imageAHash,
      }),
    );

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageABytes], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({
      outcome: "already_imported",
      imageOutcome: "already_present",
    });
  });

  it("reports a supplied different image as incomplete", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(
      record({
        moment: imageMoment(),
        revision: 2,
        imagePath: `user_a/${moment.id}/${generationA}`,
        importImageHash: imageAHash,
      }),
    );

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageBBytes], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({ outcome: "image_mismatch", imageOutcome: "mismatch" });
    expect(store.moments.updateWithImagePath).not.toHaveBeenCalled();
  });

  it("does not trust matching metadata when the stored bytes differ", async () => {
    const store = stores();
    store.moments.findImportRecord.mockResolvedValue(
      record({
        moment: imageMoment(),
        revision: 2,
        imagePath: `user_a/${moment.id}/${generationA}`,
        importImageHash: imageAHash,
      }),
    );
    store.images.download.mockResolvedValue({
      body: new Blob([imageBBytes], { type: "image/png" }),
      contentType: "image/png",
    });

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageABytes], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({ outcome: "image_mismatch", imageOutcome: "mismatch" });
  });

  it("cleans only its candidate and confirms a same-image CAS winner", async () => {
    const store = stores();
    const winnerPath = `user_a/${moment.id}/${generationB}`;
    const winner = record({
      moment: imageMoment(),
      revision: 2,
      imagePath: winnerPath,
      importImageHash: imageAHash,
    });
    store.moments.findImportRecord
      .mockResolvedValueOnce(record())
      .mockResolvedValue(winner);
    store.moments.updateWithImagePath.mockRejectedValue(
      new MomentVersionConflictError(winner.moment),
    );

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageABytes], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({
      outcome: "already_imported",
      imageOutcome: "already_present",
    });
    expect(store.images.remove).toHaveBeenCalledWith(
      `user_a/${moment.id}/${generationA}`,
    );
    expect(store.images.remove).not.toHaveBeenCalledWith(winnerPath);
  });

  it("cleans only its candidate and reports a different-image CAS winner", async () => {
    const store = stores();
    const winner = record({
      moment: imageMoment(),
      revision: 2,
      imagePath: `user_a/${moment.id}/${generationB}`,
      importImageHash: imageAHash,
    });
    store.moments.findImportRecord
      .mockResolvedValueOnce(record())
      .mockResolvedValue(winner);
    store.moments.updateWithImagePath.mockRejectedValue(
      new MomentVersionConflictError(winner.moment),
    );

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageBBytes], "legacy.png", { type: "image/png" }),
      ),
    ).resolves.toMatchObject({ outcome: "image_mismatch", imageOutcome: "mismatch" });
    expect(store.images.remove).toHaveBeenCalledWith(
      `user_a/${moment.id}/${generationA}`,
    );
  });

  it("converges concurrent image A/B imports on one row and one active object", async () => {
    let current = record();
    const objects = new Map<string, File>();
    const authorized = new Set<string>();
    const generations = [generationA, generationB];
    const moments = {
      authorizeImageCandidate: vi.fn(async (_id: string, revision: number, path: string) => {
        if (current.revision !== revision) {
          throw new MomentVersionConflictError(current.moment);
        }
        authorized.add(path);
      }),
      completeImageCleanup: vi.fn(async (path: string) => {
        authorized.delete(path);
      }),
      createImported: vi.fn(),
      findImportRecord: vi.fn(async () => current),
      updateWithImagePath: vi.fn(
        async (value: Moment, path: string, digest: string) => {
          if (current.revision !== value.revision) {
            throw new MomentVersionConflictError(current.moment);
          }
          current = record({
            moment: imageMoment(2),
            revision: 2,
            imagePath: path,
            importImageHash: digest,
          });
          authorized.delete(path);
          return { moment: current.moment, cleanupPath: null };
        },
      ),
    };
    const images = {
      download: vi.fn(async (path: string) => ({
        body: objects.get(path)!,
        contentType: objects.get(path)!.type,
      })),
      remove: vi.fn(async (path: string) => {
        objects.delete(path);
      }),
      upload: vi.fn(async (path: string, value: File) => {
        objects.set(path, value);
      }),
    };
    const makeService = () =>
      new AuthenticatedMomentImportService(
        moments,
        images,
        "user_a",
        async () => undefined,
        () => generations.shift()!,
      );

    const results = await Promise.all([
      makeService().import(
        moment,
        source,
        new File([imageABytes], "a.png", { type: "image/png" }),
      ),
      makeService().import(
        moment,
        source,
        new File([imageBBytes], "b.png", { type: "image/png" }),
      ),
    ]);

    expect(results.map((result) => result.imageOutcome).sort()).toEqual([
      "mismatch",
      "uploaded",
    ]);
    expect(objects.size).toBe(1);
    expect(objects.has(current.imagePath!)).toBe(true);
    expect(authorized.size).toBe(0);
  });

  it("cleans a failed candidate while preserving the retryable text row", async () => {
    const store = stores();
    store.moments.updateWithImagePath.mockRejectedValue(new Error("db unavailable"));

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageABytes], "legacy.png", { type: "image/png" }),
      ),
    ).rejects.toBeInstanceOf(MomentImportLifecycleError);
    expect(store.images.remove).toHaveBeenCalledWith(
      `user_a/${moment.id}/${generationA}`,
    );
    expect(store.moments.completeImageCleanup).toHaveBeenCalled();
  });

  it("reports candidate cleanup failures for later reconciliation", async () => {
    const store = stores();
    store.images.upload.mockRejectedValue(new Error("storage unavailable"));
    store.images.remove.mockRejectedValue(new Error("cleanup unavailable"));

    await expect(
      service(store).import(
        moment,
        source,
        new File([imageABytes], "legacy.png", { type: "image/png" }),
      ),
    ).rejects.toMatchObject({ cleanupFailures: [expect.any(Error)] });
    expect(store.moments.completeImageCleanup).not.toHaveBeenCalled();
  });
});
