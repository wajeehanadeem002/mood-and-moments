import { describe, expect, it } from "vitest";

import type { Moment } from "@/data/moments";
import {
  createConfiguredSupabaseClientDouble,
  createSupabaseClientDouble,
} from "@/test/supabase-query-double";

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
  revision: 1,
};

const moment: Moment = {
  id: row.id,
  revision: 1,
  date: "Aug 29, 2026",
  dateTime: "2026-08-29T04:15:30Z",
  time: "4:15 AM",
  mood: "calm",
  title: "A quiet morning",
  excerpt: "Sunlight crossed the room.",
};

describe("SupabaseMomentRepository", () => {
  it("maps the database-controlled revision into a cloud Moment", async () => {
    const { client } = createSupabaseClientDouble({
      data: [{ ...row, revision: 7 }],
      error: null,
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.list()).resolves.toEqual([
      { ...moment, revision: 7 },
    ]);
  });

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
      revision: 1,
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

  it("updates through the atomic revision RPC and returns its next revision", async () => {
    const updatedRow = {
      ...row,
      title: "A softer morning",
      mood: "loved",
      moment_date: "2026-08-28",
      updated_at: "2026-08-29T05:00:00.000Z",
    };
    const { client, rpc } = createConfiguredSupabaseClientDouble({
      rpcResults: [
        {
          data: [
            { outcome: "updated", moment: { ...updatedRow, revision: 2 }, cleanup_path: null },
          ],
          error: null,
        },
      ],
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.update({
      ...moment,
      date: "Aug 28, 2026",
      dateTime: "2026-08-28T04:15:30Z",
      mood: "loved",
      title: "A softer morning",
    })).resolves.toEqual(expect.objectContaining({ revision: 2 }));

    expect(rpc).toHaveBeenCalledWith("update_moment_if_revision", {
      requested_description: "Sunlight crossed the room.",
      requested_image_path: null,
      requested_import_image_hash: null,
      requested_moment_date: "2026-08-28",
      requested_moment_id: row.id,
      requested_mood: "loved",
      requested_revision: 1,
      requested_title: "A softer morning",
    });
  });

  it("preserves an image-bearing Moment's current private path through CAS", async () => {
    const imagePath = `${row.owner_id}/${row.id}/70000000-0000-4000-8000-000000000001`;
    const imageRow = { ...row, image_path: imagePath };
    const updatedRow = {
      ...imageRow,
      revision: 2,
      title: "A softer morning",
    };
    const { client, rpc } = createConfiguredSupabaseClientDouble(
      {
        rpcResults: [
          {
            data: [
              {
                outcome: "updated",
                moment: updatedRow,
                cleanup_path: null,
              },
            ],
            error: null,
          },
        ],
      },
      { data: imageRow, error: null },
    );
    const repository = new SupabaseMomentRepository(client);
    const imageMoment: Moment = {
      ...moment,
      title: "A softer morning",
      image: {
        src: `/api/moments/${moment.id}/image`,
        alt: "A quiet morning moment image.",
      },
    };

    await expect(repository.update(imageMoment)).resolves.toEqual(
      expect.objectContaining({ revision: 2, title: "A softer morning" }),
    );

    expect(rpc).toHaveBeenCalledWith("update_moment_if_revision", {
      requested_description: moment.excerpt,
      requested_image_path: imagePath,
      requested_import_image_hash: null,
      requested_moment_date: "2026-08-29",
      requested_moment_id: moment.id,
      requested_mood: moment.mood,
      requested_revision: 1,
      requested_title: "A softer morning",
    });
  });

  it("surfaces the latest owner-scoped Moment when a revision is stale", async () => {
    const latestRow = { ...row, revision: 2, title: "A newer title" };
    const { client } = createConfiguredSupabaseClientDouble({
      rpcResults: [
        {
          data: [{ outcome: "conflict", moment: latestRow, cleanup_path: null }],
          error: null,
        },
      ],
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.update(moment)).rejects.toMatchObject({
      name: "MomentVersionConflictError",
      currentMoment: expect.objectContaining({
        revision: 2,
        title: "A newer title",
      }),
    });
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
      revision: 1,
    });
  });

  it("updates the image reference and server-computed import digest atomically", async () => {
    const imagePath = `${row.owner_id}/${row.id}/image`;
    const importImageHash = "d".repeat(64);
    const savedRow = {
      ...row,
      revision: 2,
      image_path: imagePath,
      import_image_hash: importImageHash,
      import_source: "legacy-localstorage-v1",
      import_source_id: "legacy-1",
      import_source_hash: "c".repeat(64),
      moment_time: "09:15:30",
    };
    const { client, rpc } = createConfiguredSupabaseClientDouble({
      rpcResults: [{
        data: [{ outcome: "updated", moment: savedRow, cleanup_path: null }],
        error: null,
      }],
    });
    const repository = new SupabaseMomentRepository(client);

    await repository.updateWithImagePath(moment, imagePath, importImageHash);

    expect(rpc).toHaveBeenCalledWith("update_moment_if_revision", {
      requested_title: moment.title,
      requested_description: moment.excerpt,
      requested_mood: moment.mood,
      requested_moment_date: "2026-08-29",
      requested_moment_id: moment.id,
      requested_revision: 1,
      requested_image_path: imagePath,
      requested_import_image_hash: importImageHash,
    });
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
    const { client } = createConfiguredSupabaseClientDouble({
      rpcResults: [{
        data: [{ outcome: "not_found", moment: null, cleanup_path: null }],
        error: null,
      }],
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.update(moment)).rejects.toBeInstanceOf(
      MomentNotFoundError,
    );
  });

  it("reports a missing or RLS-hidden revision delete as not found", async () => {
    const { client, rpc } = createConfiguredSupabaseClientDouble({
      rpcResults: [{ data: [{ outcome: "not_found", moment: null, cleanup_path: null }], error: null }],
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(repository.delete(row.id, 1)).rejects.toBeInstanceOf(
      MomentNotFoundError,
    );
    expect(rpc).toHaveBeenCalledWith("delete_moment_if_revision", {
      requested_moment_id: row.id,
      requested_revision: 1,
    });
  });

  it("authorizes and completes only the server-generated image candidate", async () => {
    const path = `${row.owner_id}/${row.id}/70000000-0000-4000-8000-000000000001`;
    const { client, rpc } = createConfiguredSupabaseClientDouble({
      rpcResults: [
        { data: [{ outcome: "authorized", moment: row, cleanup_path: path }], error: null },
        { data: [{ outcome: "completed" }], error: null },
      ],
    });
    const repository = new SupabaseMomentRepository(client);

    await expect(
      repository.authorizeImageCandidate(row.id, 1, path),
    ).resolves.toBeUndefined();
    await expect(repository.completeImageCleanup(path)).resolves.toBeUndefined();

    expect(rpc).toHaveBeenNthCalledWith(1, "authorize_moment_image_candidate", {
      requested_image_path: path,
      requested_moment_id: row.id,
      requested_revision: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_moment_image_cleanup", {
      requested_image_path: path,
    });
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
