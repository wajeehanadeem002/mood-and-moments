import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseClientDouble,
  type SupabaseQueryResult,
} from "@/test/supabase-query-double";

import {
  AccountExportPersistenceError,
  SupabaseAccountExportRepository,
} from "./supabase-account-export-repository";

const ordinaryRow = {
  id: "00000000-0000-4000-8000-000000000001",
  owner_id: "user_a",
  title: "A quiet morning",
  description: "Sunlight crossed the room.",
  mood: "calm",
  moment_date: "2026-09-02",
  moment_time: null,
  image_path:
    "user_a/00000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111",
  import_source: null,
  import_source_id: null,
  import_source_hash: null,
  import_image_hash: null,
  created_at: "2026-09-02T07:46:00.000Z",
  updated_at: "2026-09-03T09:10:00.000Z",
  revision: 4,
};

function makeRepository(
  result: SupabaseQueryResult | SupabaseQueryResult[],
  image = {
    body: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    contentType: "image/png",
  },
) {
  const results = Array.isArray(result) ? result : [result];
  const { client, from, queries } = createSupabaseClientDouble(...results);
  const imageRepository = { download: vi.fn().mockResolvedValue(image) };

  return {
    repository: new SupabaseAccountExportRepository(client, imageRepository),
    from,
    imageRepository,
    queries,
  };
}

function rowForIndex(index: number) {
  return {
    ...ordinaryRow,
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    image_path: null,
    title: `Moment ${index}`,
  };
}

describe("SupabaseAccountExportRepository", () => {
  it("maps complete owner-scoped rows without exposing owner or Storage paths", async () => {
    const importedRow = {
      ...ordinaryRow,
      id: "00000000-0000-4000-8000-000000000002",
      image_path: null,
      moment_time: "19:15:30",
      import_source: "legacy-localstorage-v1",
      import_source_id: "legacy-2",
      import_source_hash: "a".repeat(64),
      import_image_hash: null,
    };
    const { repository, from, queries } = makeRepository({
      count: 2,
      data: [ordinaryRow, importedRow],
      error: null,
    });

    await expect(repository.listMoments()).resolves.toEqual([
      {
        id: ordinaryRow.id,
        revision: 4,
        title: "A quiet morning",
        description: "Sunlight crossed the room.",
        mood: "calm",
        date: "2026-09-02",
        time: null,
        createdAt: "2026-09-02T07:46:00.000Z",
        updatedAt: "2026-09-03T09:10:00.000Z",
        imagePath: ordinaryRow.image_path,
        legacyImport: null,
      },
      {
        id: importedRow.id,
        revision: 4,
        title: "A quiet morning",
        description: "Sunlight crossed the room.",
        mood: "calm",
        date: "2026-09-02",
        time: "19:15:30",
        createdAt: "2026-09-02T07:46:00.000Z",
        updatedAt: "2026-09-03T09:10:00.000Z",
        imagePath: null,
        legacyImport: {
          source: "legacy-localstorage-v1",
          sourceId: "legacy-2",
          sourceHash: "a".repeat(64),
          imageHash: null,
        },
      },
    ]);
    expect(from).toHaveBeenCalledWith("moments");
    expect(queries[0]!.order).toHaveBeenNthCalledWith(1, "moment_date", {
      ascending: false,
    });
    expect(queries[0]!.order).toHaveBeenNthCalledWith(2, "created_at", {
      ascending: false,
    });
    expect(queries[0]!.order).toHaveBeenNthCalledWith(3, "id", {
      ascending: true,
    });
    expect(queries[0]!.range).toHaveBeenCalledWith(0, 499);
  });

  it("returns an empty owner-scoped collection", async () => {
    const { repository } = makeRepository({ count: 0, data: [], error: null });

    await expect(repository.listMoments()).resolves.toEqual([]);
  });

  it.each([
    { name: "non-array collection", count: 0, data: null },
    {
      name: "malformed row",
      count: 1,
      data: [{ ...ordinaryRow, revision: 0 }],
    },
    {
      name: "inconsistent import metadata",
      count: 1,
      data: [{ ...ordinaryRow, import_source: "legacy-localstorage-v1" }],
    },
  ])("rejects a $name", async ({ count, data }) => {
    const { repository } = makeRepository({ count, data, error: null });

    await expect(repository.listMoments()).rejects.toBeInstanceOf(
      AccountExportPersistenceError,
    );
  });

  it("does not expose provider details when the owner-scoped query fails", async () => {
    const { repository } = makeRepository({
      count: null,
      data: null,
      error: { message: "private provider details" },
    });

    await expect(repository.listMoments()).rejects.toMatchObject({
      name: "AccountExportPersistenceError",
      message: "Could not load account export data from Supabase.",
    });
  });

  it("downloads a private image through the authenticated image repository", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const { repository, imageRepository } = makeRepository(
      { data: [], error: null },
      {
        body: new Blob([bytes], { type: "image/webp" }),
        contentType: "image/webp",
      },
    );

    await expect(repository.downloadImage(ordinaryRow.image_path)).resolves.toEqual({
      bytes,
      contentType: "image/webp",
    });
    expect(imageRepository.download).toHaveBeenCalledWith(
      ordinaryRow.image_path,
    );
  });

  it("returns every record across 1000+ stable pages without gaps", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => rowForIndex(index));
    const { repository, queries } = makeRepository([
      { count: 1001, data: rows.slice(0, 500), error: null },
      { count: 1001, data: rows.slice(500, 1000), error: null },
      { count: 1001, data: rows.slice(1000), error: null },
    ]);

    const moments = await repository.listMoments();

    expect(moments).toHaveLength(1001);
    expect(new Set(moments.map((moment) => moment.id))).toHaveProperty(
      "size",
      1001,
    );
    expect(queries).toHaveLength(3);
    expect(queries[0]!.range).toHaveBeenCalledWith(0, 499);
    expect(queries[1]!.range).toHaveBeenCalledWith(500, 999);
    expect(queries[2]!.range).toHaveBeenCalledWith(1000, 1499);
  });

  it("handles an exact page boundary without requesting or omitting another row", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => rowForIndex(index));
    const { repository, from, queries } = makeRepository({
      count: 500,
      data: rows,
      error: null,
    });

    await expect(repository.listMoments()).resolves.toHaveLength(500);
    expect(from).toHaveBeenCalledOnce();
    expect(queries[0]!.range).toHaveBeenCalledWith(0, 499);
  });

  it("fails closed when page overlap would duplicate an exported Moment", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      rowForIndex(index),
    );
    const { repository } = makeRepository([
      { count: 501, data: firstPage, error: null },
      { count: 501, data: [firstPage[499]], error: null },
    ]);

    await expect(repository.listMoments()).rejects.toBeInstanceOf(
      AccountExportPersistenceError,
    );
  });

  it("fails closed when pagination returns fewer rows than the exact count", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      rowForIndex(index),
    );
    const { repository } = makeRepository([
      { count: 501, data: firstPage, error: null },
      { count: 501, data: [], error: null },
    ]);

    await expect(repository.listMoments()).rejects.toBeInstanceOf(
      AccountExportPersistenceError,
    );
  });
});
