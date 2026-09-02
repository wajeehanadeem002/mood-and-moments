import { describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import type { StoredMomentRecord } from "@/repositories/supabase-moment-repository";
import {
  MomentNotFoundError,
  MomentVersionConflictError,
} from "@/repositories/supabase-moment-repository";

import {
  AuthenticatedMomentService,
  MomentImageLifecycleError,
} from "./authenticated-moment-service";

const userId = "user_clerk_a";
const momentId = "00000000-0000-4000-8000-000000000001";
const generationId = "70000000-0000-4000-8000-000000000001";
const legacyImagePath = `${userId}/${momentId}/image`;
const generationImagePath = `${userId}/${momentId}/${generationId}`;
const moment: Moment = {
  id: momentId,
  revision: 1,
  date: "Aug 29, 2026",
  dateTime: "2026-08-29T04:15:30Z",
  time: "4:15 AM",
  mood: "calm",
  title: "A quiet morning",
  excerpt: "Sunlight crossed the room.",
};
const momentWithImage: Moment = {
  ...moment,
  image: {
    src: `/api/moments/${momentId}/image`,
    alt: "A quiet morning moment image.",
  },
};
const updatedMomentWithImage: Moment = {
  ...momentWithImage,
  revision: 2,
};
const image = new File(
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  "memory.png",
  { type: "image/png" },
);
const storedImage = {
  body: new Blob(["old image"], { type: "image/png" }),
  contentType: "image/png",
};
const importImageHash = "a".repeat(64);

function createRecord(
  overrides: Partial<StoredMomentRecord> = {},
): StoredMomentRecord {
  return {
    moment: momentWithImage,
    revision: 1,
    imagePath: legacyImagePath,
    importImageHash: null,
    importSource: null,
    ...overrides,
  };
}

function createDoubles(record: StoredMomentRecord | null = null) {
  const moments = {
    authorizeImageCandidate: vi.fn().mockResolvedValue(undefined),
    completeImageCleanup: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(moment),
    deleteRecord: vi.fn().mockResolvedValue({
      cleanupPath: record?.imagePath ?? null,
    }),
    findRecordById: vi.fn().mockResolvedValue(record),
    list: vi.fn().mockResolvedValue(record ? [record.moment] : []),
    updateWithImagePath: vi.fn().mockResolvedValue({
      moment: updatedMomentWithImage,
      cleanupPath: record?.imagePath ?? null,
    }),
  };
  const images = {
    download: vi.fn().mockResolvedValue(storedImage),
    remove: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthenticatedMomentService(
    moments,
    images,
    userId,
    () => generationId,
  );

  return { images, moments, service };
}

describe("AuthenticatedMomentService immutable image lifecycle", () => {
  it("uploads a unique candidate before atomically linking it on create", async () => {
    const { images, moments, service } = createDoubles();
    moments.updateWithImagePath.mockResolvedValueOnce({
      moment: updatedMomentWithImage,
      cleanupPath: null,
    });

    await expect(service.create(moment, image)).resolves.toEqual(
      updatedMomentWithImage,
    );

    expect(moments.authorizeImageCandidate).toHaveBeenCalledWith(
      momentId,
      1,
      generationImagePath,
    );
    expect(images.upload).toHaveBeenCalledWith(generationImagePath, image);
    expect(moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      generationImagePath,
      null,
    );
  });

  it("cleans only its candidate authorization and row when create upload fails", async () => {
    const { images, moments, service } = createDoubles();
    images.upload.mockRejectedValueOnce(new Error("upload failed"));

    await expect(service.create(moment, image)).rejects.toBeInstanceOf(
      MomentImageLifecycleError,
    );

    expect(images.remove).toHaveBeenCalledWith(generationImagePath);
    expect(moments.completeImageCleanup).toHaveBeenCalledWith(
      generationImagePath,
    );
    expect(moments.deleteRecord).toHaveBeenCalledWith(momentId, 1);
  });

  it("reconciles an image create whose committed link response was lost", async () => {
    const committedRecord = createRecord({
      moment: updatedMomentWithImage,
      revision: 2,
      imagePath: generationImagePath,
    });
    const { images, moments, service } = createDoubles();
    moments.updateWithImagePath.mockRejectedValueOnce(
      new Error("connection lost after commit"),
    );
    moments.findRecordById.mockResolvedValueOnce(committedRecord);

    await expect(service.create(moment, image)).resolves.toEqual(
      updatedMomentWithImage,
    );

    expect(images.remove).not.toHaveBeenCalled();
    expect(moments.deleteRecord).not.toHaveBeenCalled();
  });

  it("does not delete a concurrently changed create row after losing its link CAS", async () => {
    const { images, moments, service } = createDoubles();
    const current = { ...moment, revision: 2 };
    moments.updateWithImagePath.mockRejectedValueOnce(
      new MomentVersionConflictError(current),
    );

    await expect(service.create(moment, image)).rejects.toMatchObject({
      name: "MomentVersionConflictError",
      currentMoment: current,
    });

    expect(images.remove).toHaveBeenCalledWith(generationImagePath);
    expect(moments.completeImageCleanup).toHaveBeenCalledWith(
      generationImagePath,
    );
    expect(moments.deleteRecord).not.toHaveBeenCalled();
  });

  it("switches to an immutable replacement before cleaning the old object", async () => {
    const record = createRecord();
    const { images, moments, service } = createDoubles(record);

    await expect(
      service.updateRecord(record, moment, { kind: "replace", image }),
    ).resolves.toEqual(updatedMomentWithImage);

    expect(moments.authorizeImageCandidate).toHaveBeenCalledWith(
      momentId,
      1,
      generationImagePath,
    );
    expect(images.upload).toHaveBeenCalledWith(generationImagePath, image);
    expect(moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      generationImagePath,
      null,
    );
    expect(images.remove).toHaveBeenCalledWith(legacyImagePath);
    expect(moments.completeImageCleanup).toHaveBeenCalledWith(legacyImagePath);
    expect(images.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      moments.updateWithImagePath.mock.invocationCallOrder[0],
    );
  });

  it("cleans only the losing candidate when an image replacement CAS conflicts", async () => {
    const record = createRecord();
    const current = { ...updatedMomentWithImage, title: "Winner" };
    const { images, moments, service } = createDoubles(record);
    moments.updateWithImagePath.mockRejectedValueOnce(
      new MomentVersionConflictError(current),
    );

    await expect(
      service.updateRecord(record, moment, { kind: "replace", image }),
    ).rejects.toMatchObject({
      name: "MomentVersionConflictError",
      currentMoment: current,
    });

    expect(images.remove).toHaveBeenCalledTimes(1);
    expect(images.remove).toHaveBeenCalledWith(generationImagePath);
    expect(images.remove).not.toHaveBeenCalledWith(legacyImagePath);
    expect(moments.completeImageCleanup).toHaveBeenCalledWith(
      generationImagePath,
    );
  });

  it("reconciles a replacement whose committed CAS response was lost", async () => {
    const record = createRecord();
    const committedRecord = createRecord({
      moment: updatedMomentWithImage,
      revision: 2,
      imagePath: generationImagePath,
    });
    const { images, moments, service } = createDoubles(record);
    moments.updateWithImagePath.mockRejectedValueOnce(
      new Error("connection lost after commit"),
    );
    moments.findRecordById.mockResolvedValueOnce(committedRecord);

    await expect(
      service.updateRecord(record, moment, { kind: "replace", image }),
    ).resolves.toEqual(updatedMomentWithImage);

    expect(images.remove).toHaveBeenCalledWith(legacyImagePath);
    expect(images.remove).not.toHaveBeenCalledWith(generationImagePath);
  });

  it("commits image removal before deleting the former object", async () => {
    const record = createRecord();
    const withoutImage = { ...moment, revision: 2 };
    const { images, moments, service } = createDoubles(record);
    moments.updateWithImagePath.mockResolvedValueOnce({
      moment: withoutImage,
      cleanupPath: legacyImagePath,
    });

    await expect(
      service.updateRecord(record, moment, { kind: "remove" }),
    ).resolves.toEqual(withoutImage);

    expect(moments.updateWithImagePath).toHaveBeenCalledWith(moment, null, null);
    expect(images.remove).toHaveBeenCalledWith(legacyImagePath);
    expect(images.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      moments.updateWithImagePath.mock.invocationCallOrder[0],
    );
  });

  it("leaves the active image untouched when image removal loses its CAS", async () => {
    const record = createRecord();
    const { images, moments, service } = createDoubles(record);
    moments.updateWithImagePath.mockRejectedValueOnce(
      new MomentVersionConflictError(updatedMomentWithImage),
    );

    await expect(
      service.updateRecord(record, moment, { kind: "remove" }),
    ).rejects.toBeInstanceOf(MomentVersionConflictError);

    expect(images.remove).not.toHaveBeenCalled();
  });

  it("reconciles image removal whose committed CAS response was lost", async () => {
    const record = createRecord();
    const withoutImage = { ...moment, revision: 2 };
    const { images, moments, service } = createDoubles(record);
    moments.updateWithImagePath.mockRejectedValueOnce(
      new Error("connection lost after commit"),
    );
    moments.findRecordById.mockResolvedValueOnce(
      createRecord({
        moment: withoutImage,
        revision: 2,
        imagePath: null,
      }),
    );

    await expect(
      service.updateRecord(record, moment, { kind: "remove" }),
    ).resolves.toEqual(withoutImage);
    expect(images.remove).toHaveBeenCalledWith(legacyImagePath);
  });

  it("deletes the row by revision before cleaning its authorized image", async () => {
    const record = createRecord();
    const { images, moments, service } = createDoubles(record);

    await expect(service.delete(momentId, 1)).resolves.toBeUndefined();

    expect(moments.deleteRecord).toHaveBeenCalledWith(momentId, 1);
    expect(images.remove).toHaveBeenCalledWith(legacyImagePath);
    expect(images.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      moments.deleteRecord.mock.invocationCallOrder[0],
    );
  });

  it("does not clean an image when delete loses its revision CAS", async () => {
    const record = createRecord();
    const { images, moments, service } = createDoubles(record);
    moments.deleteRecord.mockRejectedValueOnce(
      new MomentVersionConflictError(updatedMomentWithImage),
    );

    await expect(service.delete(momentId, 1)).rejects.toBeInstanceOf(
      MomentVersionConflictError,
    );

    expect(images.remove).not.toHaveBeenCalled();
  });

  it("reports exactly one winner when concurrent deletes reach an explicit not-found outcome", async () => {
    const record = createRecord({ imagePath: null, moment });
    const { images, moments, service: first } = createDoubles(record);
    const second = new AuthenticatedMomentService(
      moments,
      images,
      userId,
      () => generationId,
    );
    let initialReadCount = 0;
    let releaseInitialReads!: () => void;
    const bothInitialReads = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    let deleteCallCount = 0;
    let releaseDeleteCalls!: () => void;
    const bothDeleteCalls = new Promise<void>((resolve) => {
      releaseDeleteCalls = resolve;
    });
    let releaseWinner!: () => void;
    const winnerCommitted = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });

    moments.findRecordById.mockImplementation(async () => {
      initialReadCount += 1;
      if (initialReadCount <= 2) {
        if (initialReadCount === 2) releaseInitialReads();
        await bothInitialReads;
        return record;
      }
      return null;
    });
    moments.deleteRecord.mockImplementation(async () => {
      deleteCallCount += 1;
      const call = deleteCallCount;
      if (deleteCallCount === 2) releaseDeleteCalls();
      await bothDeleteCalls;

      if (call === 1) {
        releaseWinner();
        return { cleanupPath: null };
      }

      await winnerCommitted;
      throw new MomentNotFoundError();
    });

    const results = await Promise.allSettled([
      first.delete(momentId, 1),
      second.delete(momentId, 1),
    ]);

    expect(results[0]).toEqual({ status: "fulfilled", value: undefined });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: expect.any(MomentNotFoundError),
    });
    expect(moments.deleteRecord).toHaveBeenCalledTimes(2);
    expect(moments.findRecordById).toHaveBeenCalledTimes(2);
    expect(images.remove).not.toHaveBeenCalled();
  });

  it("reconciles a committed delete whose RPC response was lost", async () => {
    const record = createRecord();
    const { images, moments, service } = createDoubles(record);
    moments.findRecordById.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
    moments.deleteRecord.mockRejectedValueOnce(
      new Error("connection lost after commit"),
    );

    await expect(service.delete(momentId, 1)).resolves.toBeUndefined();
    expect(images.remove).toHaveBeenCalledWith(legacyImagePath);
  });

  it("downloads an owned immutable generation path", async () => {
    const record = createRecord({ imagePath: generationImagePath });
    const { images, service } = createDoubles(record);

    await expect(service.download(momentId)).resolves.toEqual(storedImage);
    expect(images.download).toHaveBeenCalledWith(generationImagePath);
  });

  it("updates an imported image and its digest in the same CAS", async () => {
    const record = createRecord({
      importImageHash,
      importSource: "legacy-localstorage-v1",
    });
    const { moments, service } = createDoubles(record);

    await service.updateRecord(record, moment, { kind: "replace", image });

    expect(moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      generationImagePath,
      "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
    );
  });
});
