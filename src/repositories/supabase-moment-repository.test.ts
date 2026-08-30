import { describe, expect, it } from "vitest";

import type { Moment } from "@/data/moments";
import { createSupabaseClientDouble } from "@/test/supabase-query-double";

import {
  MomentImportConflictError,
  MomentNotFoundError,
  MomentPersistenceError,
  SupabaseMomentRepository,
} from "./supabase-moment-repository";

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  owner_id: "user_a",
  title: "A quiet morning",
  description: "Sunlight crossed the room.",
  mood: "calm",
  moment_date: "2026-08-29",
  moment_time: null,
  image_path: null,
  import_source: null,
  import_source_id: null,
  import_source_hash: null,
  import_image_hash: null,
  created_at: "2026-08-29T04:15:30.000Z",
  updated_at: "2026-08-29T04:15:30.000Z",
};

const moment: Moment = {
  id: row.id,
  date: "Aug 29, 2026",
  dateTime: "2026-08-29T04:15:30Z",
  time: "4:15 AM",
  mood: "calm",
  title: "A quiet morning",
  excerpt: "Sunlight crossed the room.",
};

describe("SupabaseMomentRepository", () => {
  it("lists database rows as display-ready Moments in timeline order", async () => {
    const { client, from, queries } = createSupabaseClientDouble({
      data: [row],
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.list()).resolves.toEqual([moment]);
    const query = queries[0]!;
    expect(from).toHaveBeenCalledWith("moments");
    expect(query.order).toHaveBeenNthCalledWith(1, "moment_date", {
      ascending: false,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, "created_at", {
      ascending: false,
    });
  });

  it("maps a private image reference to the authenticated image proxy", async () => {
    const imageRow = {
      ...row,
      image_path: `${row.owner_id}/${row.id}/image`,
    };
    const { client } = createSupabaseClientDouble({
      data: [imageRow],
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.list()).resolves.toEqual([
      {
        ...moment,
        image: {
          src: `/api/moments/${row.id}/image`,
          alt: "A quiet morning moment image.",
        },
      },
    ]);
  });

  it("preserves an imported Moment time instead of using created_at", async () => {
    const importedRow = {
      ...row,
      moment_time: "09:15:30",
      import_source: "legacy-localstorage-v1",
      import_source_id: "legacy-1",
      import_source_hash: "a".repeat(64),
    };
    const { client } = createSupabaseClientDouble({
      data: [importedRow],
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.list()).resolves.toEqual([
      {
        ...moment,
        dateTime: "2026-08-29T09:15:30",
        time: "9:15 AM",
      },
    ]);
  });

  it("finds an owner-scoped imported record by immutable source identity", async () => {
    const importedRow = {
      ...row,
      moment_time: "09:15:30",
      import_source: "legacy-localstorage-v1",
      import_source_id: "legacy-1",
      import_source_hash: "b".repeat(64),
    };
    const { client, queries } = createSupabaseClientDouble({
      data: importedRow,
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.findImportRecord("legacy-1")).resolves.toEqual({
      moment: {
        ...moment,
        dateTime: "2026-08-29T09:15:30",
        time: "9:15 AM",
      },
      imagePath: null,
      importImageHash: null,
      importSource: "legacy-localstorage-v1",
      sourceHash: "b".repeat(64),
      sourceId: "legacy-1",
    });
    expect(queries[0]!.eq).toHaveBeenNthCalledWith(
      1,
      "import_source",
      "legacy-localstorage-v1",
    );
    expect(queries[0]!.eq).toHaveBeenNthCalledWith(2, "import_source_id", "legacy-1");
  });

  it("creates an imported row with server-normalized source metadata and time", async () => {
    const importedRow = {
      ...row,
      moment_time: "09:15:30",
      import_source: "legacy-localstorage-v1",
      import_source_id: "legacy-1",
      import_source_hash: "c".repeat(64),
    };
    const { client, queries } = createSupabaseClientDouble({
      data: importedRow,
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await repository.createImported(moment, {
      sourceHash: "c".repeat(64),
      sourceId: "legacy-1",
      time: "09:15:30",
    });

    expect(queries[0]!.insert).toHaveBeenCalledWith({
      title: moment.title,
      description: moment.excerpt,
      mood: moment.mood,
      moment_date: "2026-08-29",
      moment_time: "09:15:30",
      import_source: "legacy-localstorage-v1",
      import_source_id: "legacy-1",
      import_source_hash: "c".repeat(64),
    });
  });

  it("identifies a concurrent idempotency conflict without exposing database details", async () => {
    const { client } = createSupabaseClientDouble({
      data: null,
      error: { code: "23505", message: "unique index details" },
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(
      repository.createImported(moment, {
        sourceHash: "c".repeat(64),
        sourceId: "legacy-1",
        time: "09:15:30",
      }),
    ).rejects.toBeInstanceOf(MomentImportConflictError);
  });

  it("creates a Moment without caller-controlled identity, id, or image data", async () => {
    const { client, queries } = createSupabaseClientDouble({
      data: row,
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);
    const momentWithDeferredImage: Moment = {
      ...moment,
      image: {
        src: "data:image/png;base64,aW1hZ2U=",
        alt: "A local-only image.",
      },
    };

    await expect(repository.create(momentWithDeferredImage)).resolves.toEqual(
      moment,
    );
    const query = queries[0]!;
    expect(query.insert).toHaveBeenCalledWith({
      title: "A quiet morning",
      description: "Sunlight crossed the room.",
      mood: "calm",
      moment_date: "2026-08-29",
    });
  });

  it("updates only editable Moment fields and scopes the mutation by id", async () => {
    const updatedRow = {
      ...row,
      title: "A softer morning",
      mood: "loved",
      moment_date: "2026-08-28",
      updated_at: "2026-08-29T05:00:00.000Z",
    };
    const { client, queries } = createSupabaseClientDouble({
      data: updatedRow,
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await repository.update({
      ...moment,
      date: "Aug 28, 2026",
      dateTime: "2026-08-28T04:15:30Z",
      mood: "loved",
      title: "A softer morning",
    });
    const query = queries[0]!;

    expect(query.update).toHaveBeenCalledWith({
      title: "A softer morning",
      description: "Sunlight crossed the room.",
      mood: "loved",
      moment_date: "2026-08-28",
    });
    expect(query.eq).toHaveBeenCalledWith("id", row.id);
  });

  it("returns null when RLS hides a requested Moment", async () => {
    const { client, queries } = createSupabaseClientDouble({
      data: null,
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.findById(row.id)).resolves.toBeNull();
    const query = queries[0]!;
    expect(query.eq).toHaveBeenCalledWith("id", row.id);
  });

  it("returns the server-only image path with an owner-scoped record", async () => {
    const imagePath = `${row.owner_id}/${row.id}/image`;
    const { client } = createSupabaseClientDouble({
      data: { ...row, image_path: imagePath },
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.findRecordById(row.id)).resolves.toEqual({
      moment: {
        ...moment,
        image: {
          src: `/api/moments/${row.id}/image`,
          alt: "A quiet morning moment image.",
        },
      },
      imagePath,
      importImageHash: null,
      importSource: null,
    });
  });

  it("updates the image reference and server-computed import digest atomically", async () => {
    const imagePath = `${row.owner_id}/${row.id}/image`;
    const importImageHash = "d".repeat(64);
    const { client, queries } = createSupabaseClientDouble({
      data: {
        ...row,
        image_path: imagePath,
        import_image_hash: importImageHash,
        import_source: "legacy-localstorage-v1",
        import_source_id: "legacy-1",
        import_source_hash: "c".repeat(64),
        moment_time: "09:15:30",
      },
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await repository.updateWithImagePath(moment, imagePath, importImageHash);

    expect(queries[0]!.update).toHaveBeenCalledWith({
      title: moment.title,
      description: moment.excerpt,
      mood: moment.mood,
      moment_date: "2026-08-29",
      image_path: imagePath,
      import_image_hash: importImageHash,
    });
    expect(queries[0]!.eq).toHaveBeenCalledWith("id", row.id);
  });

  it("fails closed when an imported image digest is malformed", async () => {
    const { client } = createSupabaseClientDouble({
      data: {
        ...row,
        image_path: `${row.owner_id}/${row.id}/image`,
        import_image_hash: "not-a-sha256",
        import_source: "legacy-localstorage-v1",
        import_source_id: "legacy-1",
        import_source_hash: "c".repeat(64),
        moment_time: "09:15:30",
      },
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.findRecordById(row.id)).rejects.toBeInstanceOf(
      MomentPersistenceError,
    );
  });

  it("reports a missing or RLS-hidden update as not found", async () => {
    const { client } = createSupabaseClientDouble({
      data: null,
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.update(moment)).rejects.toBeInstanceOf(
      MomentNotFoundError,
    );
  });

  it("reports a missing or RLS-hidden delete as not found", async () => {
    const { client, queries } = createSupabaseClientDouble({
      data: null,
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.delete(row.id)).rejects.toBeInstanceOf(
      MomentNotFoundError,
    );
    const query = queries[0]!;
    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.eq).toHaveBeenCalledWith("id", row.id);
  });

  it("deletes import compensation only while its image is still unlinked", async () => {
    const { client, queries } = createSupabaseClientDouble({
      data: { id: row.id },
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(
      repository.deleteIncompleteImport(row.id),
    ).resolves.toBe(true);
    expect(queries[0]!.delete).toHaveBeenCalledOnce();
    expect(queries[0]!.eq).toHaveBeenNthCalledWith(1, "id", row.id);
    expect(queries[0]!.eq).toHaveBeenNthCalledWith(
      2,
      "import_source",
      "legacy-localstorage-v1",
    );
    expect(queries[0]!.is).toHaveBeenCalledWith("image_path", null);
  });

  it("converts Supabase failures into a typed persistence error", async () => {
    const { client } = createSupabaseClientDouble({
      data: null,
      error: { code: "08006", message: "connection details" },
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.list()).rejects.toBeInstanceOf(
      MomentPersistenceError,
    );
  });

  it("fails closed when Supabase returns a malformed row", async () => {
    const { client } = createSupabaseClientDouble({
      data: [{ ...row, mood: "unknown" }],
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.list()).rejects.toBeInstanceOf(
      MomentPersistenceError,
    );
  });
});
