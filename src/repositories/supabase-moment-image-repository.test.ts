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
  it("upserts an owner-scoped import image for retry reconciliation", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path }, error: null });
    const client = {
      storage: { from: vi.fn(() => ({ upload })) },
    } as unknown as SupabaseClient;
    const repository = new SupabaseMomentImageRepository(client);
    const image = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "legacy.png",
      { type: "image/png" },
    );

    await repository.upsert(path, image);

    expect(upload).toHaveBeenCalledWith(path, image, {
      cacheControl: "3600",
      contentType: "image/png",
      upsert: true,
    });
  });

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

  it("retrieves the replacement bytes instead of a cached previous image", async () => {
    const imageABytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x41,
    ]);
    const imageBBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x42,
    ]);
    let origin = new Blob([imageABytes], { type: "image/png" });
    const cachedResponses = new Map<string, Blob>();
    const download = vi.fn(
      async (
        _path: string,
        options?: { cacheNonce?: string },
      ) => {
        const cacheKey = options?.cacheNonce ?? "stable-path";
        const cached = cachedResponses.get(cacheKey);

        if (cached) {
          return { data: cached, error: null };
        }

        cachedResponses.set(cacheKey, origin);
        return { data: origin, error: null };
      },
    );
    const update = vi.fn(async (_path: string, body: Blob) => {
      origin = body;
      return { data: { path }, error: null };
    });
    const client = {
      storage: { from: vi.fn(() => ({ download, update })) },
    } as unknown as SupabaseClient;
    const repository = new SupabaseMomentImageRepository(client);

    const first = await repository.download(path);
    expect(new Uint8Array(await first.body.arrayBuffer())).toEqual(imageABytes);

    const replacement = new File([imageBBytes], "replacement.png", {
      type: "image/png",
    });
    await repository.replace(path, replacement);

    const second = await repository.download(path);
    expect(new Uint8Array(await second.body.arrayBuffer())).toEqual(imageBBytes);
    expect(download).toHaveBeenNthCalledWith(
      1,
      path,
      { cacheNonce: expect.any(String) },
      { cache: "no-store" },
    );
    expect(download).toHaveBeenNthCalledWith(
      2,
      path,
      { cacheNonce: expect.any(String) },
      { cache: "no-store" },
    );
    expect(download.mock.calls[0]?.[1]?.cacheNonce).not.toBe(
      download.mock.calls[1]?.[1]?.cacheNonce,
    );
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
