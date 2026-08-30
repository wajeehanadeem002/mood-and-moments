import { describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import type { MomentImageMutation } from "@/lib/moment-request-validation";
import type { StoredMomentRecord } from "@/repositories/supabase-moment-repository";

import {
  AuthenticatedMomentService,
  MomentImageLifecycleError,
} from "./authenticated-moment-service";

const userId = "user_clerk_a";
const momentId = "00000000-0000-4000-8000-000000000001";
const imagePath = `${userId}/${momentId}/image`;
const moment: Moment = {
  id: momentId,
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
const image = new File(
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  "memory.png",
  { type: "image/png" },
);
const backup = {
  body: new Blob(["old image"], { type: "image/png" }),
  contentType: "image/png",
};
const importImageHash = "a".repeat(64);

function createDoubles(record: StoredMomentRecord | null = null) {
  const moments = {
    create: vi.fn().mockResolvedValue(moment),
    delete: vi.fn().mockResolvedValue(undefined),
    findRecordById: vi.fn().mockResolvedValue(record),
    list: vi.fn().mockResolvedValue(record ? [record.moment] : []),
    update: vi.fn().mockImplementation(async (value: Moment) => value),
    updateWithImagePath: vi
      .fn()
      .mockImplementation(
        async (value: Moment, path: string | null) => ({
        ...value,
        ...(path
          ? {
              image: {
                src: `/api/moments/${value.id}/image`,
                alt: `${value.title} moment image.`,
              },
            }
          : { image: undefined }),
        }),
      ),
  };
  const images = {
    download: vi.fn().mockResolvedValue(backup),
    remove: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AuthenticatedMomentService(
    moments,
    images,
    userId,
  );

  return { images, moments, service };
}

describe("AuthenticatedMomentService image lifecycle", () => {
  it("creates the stable private path from Clerk identity and the database id", async () => {
    const { images, moments, service } = createDoubles();

    await expect(service.create(moment, image)).resolves.toEqual(momentWithImage);

    expect(images.upload).toHaveBeenCalledWith(imagePath, image);
    expect(moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      imagePath,
      null,
    );
  });

  it("removes a possible partial object and row if create upload fails", async () => {
    const { images, moments, service } = createDoubles();
    images.upload.mockRejectedValueOnce(new Error("upload failed"));

    await expect(service.create(moment, image)).rejects.toBeInstanceOf(
      MomentImageLifecycleError,
    );

    expect(images.remove).toHaveBeenCalledWith(imagePath);
    expect(moments.delete).toHaveBeenCalledWith(momentId);
  });

  it("cleans up the object and row if linking the uploaded image fails", async () => {
    const { images, moments, service } = createDoubles();
    moments.updateWithImagePath.mockRejectedValueOnce(new Error("db failed"));

    await expect(service.create(moment, image)).rejects.toBeInstanceOf(
      MomentImageLifecycleError,
    );

    expect(images.remove).toHaveBeenCalledWith(imagePath);
    expect(moments.delete).toHaveBeenCalledWith(momentId);
  });

  it("replaces an existing image and keeps the stable path", async () => {
    const record = {
      moment: momentWithImage,
      imagePath,
      importImageHash: null,
      importSource: null,
    };
    const { images, moments, service } = createDoubles(record);
    const mutation: MomentImageMutation = { kind: "replace", image };

    await expect(service.update(momentId, moment, mutation)).resolves.toEqual(
      momentWithImage,
    );

    expect(images.download).toHaveBeenCalledWith(imagePath);
    expect(images.replace).toHaveBeenCalledWith(imagePath, image);
    expect(moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      imagePath,
      null,
    );
  });

  it("restores the previous object and database row if replacement linking fails", async () => {
    const record = {
      moment: momentWithImage,
      imagePath,
      importImageHash: null,
      importSource: null,
    };
    const { images, moments, service } = createDoubles(record);
    moments.updateWithImagePath
      .mockRejectedValueOnce(new Error("db failed"))
      .mockResolvedValueOnce(momentWithImage);

    await expect(
      service.update(momentId, moment, { kind: "replace", image }),
    ).rejects.toBeInstanceOf(MomentImageLifecycleError);

    expect(images.restore).toHaveBeenCalledWith(imagePath, backup);
    expect(moments.updateWithImagePath).toHaveBeenLastCalledWith(
      momentWithImage,
      imagePath,
      null,
    );
  });

  it("removes an image and clears its database reference", async () => {
    const record = {
      moment: momentWithImage,
      imagePath,
      importImageHash: null,
      importSource: null,
    };
    const { images, moments, service } = createDoubles(record);

    await expect(
      service.update(momentId, moment, { kind: "remove" }),
    ).resolves.toEqual(expect.objectContaining({ image: undefined }));

    expect(images.remove).toHaveBeenCalledWith(imagePath);
    expect(moments.updateWithImagePath).toHaveBeenCalledWith(moment, null, null);
  });

  it("restores both object and row when image removal cannot complete", async () => {
    const record = {
      moment: momentWithImage,
      imagePath,
      importImageHash: null,
      importSource: null,
    };
    const { images, moments, service } = createDoubles(record);
    moments.updateWithImagePath
      .mockRejectedValueOnce(new Error("db failed"))
      .mockResolvedValueOnce(momentWithImage);

    await expect(
      service.update(momentId, moment, { kind: "remove" }),
    ).rejects.toBeInstanceOf(MomentImageLifecycleError);

    expect(images.restore).toHaveBeenCalledWith(imagePath, backup);
    expect(moments.updateWithImagePath).toHaveBeenLastCalledWith(
      momentWithImage,
      imagePath,
      null,
    );
  });

  it("restores a deleted object when database deletion fails", async () => {
    const record = {
      moment: momentWithImage,
      imagePath,
      importImageHash: null,
      importSource: null,
    };
    const { images, moments, service } = createDoubles(record);
    moments.delete.mockRejectedValueOnce(new Error("db failed"));

    await expect(service.delete(momentId)).rejects.toBeInstanceOf(
      MomentImageLifecycleError,
    );

    expect(images.remove).toHaveBeenCalledWith(imagePath);
    expect(images.restore).toHaveBeenCalledWith(imagePath, backup);
  });

  it("downloads only the computed stable path after an RLS-backed lookup", async () => {
    const record = {
      moment: momentWithImage,
      imagePath,
      importImageHash: null,
      importSource: null,
    };
    const { images, service } = createDoubles(record);

    await expect(service.download(momentId)).resolves.toEqual(backup);
    expect(images.download).toHaveBeenCalledWith(imagePath);
  });

  it("updates an imported image and its digest together", async () => {
    const record: StoredMomentRecord = {
      moment: momentWithImage,
      imagePath,
      importImageHash,
      importSource: "legacy-localstorage-v1",
    };
    const { moments, service } = createDoubles(record);

    await service.update(momentId, moment, { kind: "replace", image });

    expect(moments.updateWithImagePath).toHaveBeenCalledWith(
      moment,
      imagePath,
      "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
    );
  });

  it("clears an imported image digest when its image is removed", async () => {
    const record: StoredMomentRecord = {
      moment: momentWithImage,
      imagePath,
      importImageHash,
      importSource: "legacy-localstorage-v1",
    };
    const { moments, service } = createDoubles(record);

    await service.update(momentId, moment, { kind: "remove" });

    expect(moments.updateWithImagePath).toHaveBeenCalledWith(moment, null, null);
  });
});
