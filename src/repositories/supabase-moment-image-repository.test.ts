import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  MomentImagePersistenceError,
  SupabaseMomentImageRepository,
} from "./supabase-moment-image-repository";

function createStorageDouble(
  results: Partial<
    Record<"download" | "remove" | "update" | "upload", unknown>
  > = {},
) {
  const bucket = {
    download: vi.fn().mockResolvedValue(results.download ?? {
      data: new Blob(["old image"], { type: "image/png" }),
      error: null,
    }),
    remove: vi.fn().mockResolvedValue(results.remove ?? { data: [], error: null }),
    update: vi.fn().mockResolvedValue(results.update ?? { data: {}, error: null }),
    upload: vi.fn().mockResolvedValue(results.upload ?? { data: {}, error: null }),
  };
  const from = vi.fn().mockReturnValue(bucket);
  const client = { storage: { from } } as unknown as SupabaseClient;

  return { bucket, client, from };
}

const path = "user_a/00000000-0000-4000-8000-000000000001/image";
const image = new File(["new image"], "memory.png", { type: "image/png" });

describe("SupabaseMomentImageRepository", () => {
  it("uploads to the private bucket without path mutation", async () => {
    const { bucket, client, from } = createStorageDouble();
    const repository = new SupabaseMomentImageRepository(client);

    await repository.upload(path, image);

    expect(from).toHaveBeenCalledWith("moment-images");
    expect(bucket.upload).toHaveBeenCalledWith(path, image, {
      cacheControl: "3600",
      contentType: "image/png",
      upsert: false,
    });
  });

  it("replaces an existing object through the Storage update policy", async () => {
    const { bucket, client } = createStorageDouble();
    const repository = new SupabaseMomentImageRepository(client);

    await repository.replace(path, image);

    expect(bucket.update).toHaveBeenCalledWith(path, image, {
      cacheControl: "3600",
      contentType: "image/png",
      upsert: false,
    });
  });

  it("restores a backup with upsert for failure compensation", async () => {
    const { bucket, client } = createStorageDouble();
    const repository = new SupabaseMomentImageRepository(client);
    const backup = new Blob(["old image"], { type: "image/jpeg" });

    await repository.restore(path, {
      body: backup,
      contentType: "image/jpeg",
    });

    expect(bucket.upload).toHaveBeenCalledWith(path, backup, {
      cacheControl: "3600",
      contentType: "image/jpeg",
      upsert: true,
    });
  });

  it("downloads a private object with its content type", async () => {
    const blob = new Blob(["image"], { type: "image/webp" });
    const { client } = createStorageDouble({
      download: { data: blob, error: null },
    });
    const repository = new SupabaseMomentImageRepository(client);

    await expect(repository.download(path)).resolves.toEqual({
      body: blob,
      contentType: "image/webp",
    });
  });

  it("removes only the supplied stable object path", async () => {
    const { bucket, client } = createStorageDouble();
    const repository = new SupabaseMomentImageRepository(client);

    await repository.remove(path);

    expect(bucket.remove).toHaveBeenCalledWith([path]);
  });

  it.each(["upload", "update", "download", "remove"] as const)(
    "normalizes a Storage %s failure without exposing provider details",
    async (operation) => {
      const result = { data: null, error: { message: "provider detail" } };
      const { client } = createStorageDouble({ [operation]: result });
      const repository = new SupabaseMomentImageRepository(client);
      const action =
        operation === "update"
          ? repository.replace(path, image)
          : operation === "download"
            ? repository.download(path)
            : operation === "remove"
              ? repository.remove(path)
              : repository.upload(path, image);

      await expect(action).rejects.toBeInstanceOf(MomentImagePersistenceError);
    },
  );
});
