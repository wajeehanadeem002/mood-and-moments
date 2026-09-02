import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseAuthenticationError } from "@/lib/supabase/server";
import {
  createConfiguredSupabaseClientDouble,
  type SupabaseRpcResult,
} from "@/test/supabase-query-double";

const { createAuthenticatedClientMock } = vi.hoisted(() => ({
  createAuthenticatedClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createAuthenticatedSupabaseClient: createAuthenticatedClientMock,
}));

import { DELETE, PATCH } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const row = {
  id,
  owner_id: "user_a",
  title: "A quiet morning",
  description: "Sunlight crossed the room.",
  mood: "calm",
  moment_date: "2026-08-29",
  moment_time: null,
  import_source: null,
  import_source_id: null,
  import_source_hash: null,
  import_image_hash: null,
  image_path: null,
  created_at: "2026-08-29T04:15:30.000Z",
  updated_at: "2026-08-29T04:15:30.000Z",
  revision: 1,
};
const updatedRow = {
  ...row,
  title: "A softer morning",
  mood: "loved",
  updated_at: "2026-08-29T04:16:30.000Z",
  revision: 2,
};

const allowedMutation: SupabaseRpcResult = {
  data: [
    {
      allowed: true,
      limit_value: 30,
      remaining: 29,
      retry_after_seconds: 60,
    },
  ],
  error: null,
};

function mutationResult(
  outcome: "conflict" | "deleted" | "not_found" | "updated",
  moment: unknown,
  cleanupPath: string | null = null,
): SupabaseRpcResult {
  return {
    data: [{ outcome, moment, cleanup_path: cleanupPath }],
    error: null,
  };
}

function context(momentId = id) {
  return { params: Promise.resolve({ id: momentId }) };
}

function authenticateWith(client: object) {
  createAuthenticatedClientMock.mockResolvedValue({
    client,
    userId: "user_a",
  });
}

function addStorage(client: object) {
  const bucket = {
    download: vi.fn(),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
  Object.assign(client, {
    storage: { from: vi.fn().mockReturnValue(bucket) },
  });
  return bucket;
}

function multipartRequest(formData: FormData) {
  const value = new Request(`http://localhost/api/moments/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "multipart/form-data; boundary=test",
      "X-Moment-Revision": "1",
    },
  });
  vi.spyOn(value, "formData").mockResolvedValue(formData);
  return value;
}

function request(
  method: "DELETE" | "PATCH",
  options: {
    body?: unknown;
    ifMatch?: string;
    momentRevision?: string;
  } = {},
) {
  return new Request(`http://localhost/api/moments/${id}`, {
    method,
    headers: {
      ...(method === "PATCH" ? { "content-type": "application/json" } : {}),
      ...(options.ifMatch ? { "If-Match": options.ifMatch } : {}),
      ...(options.momentRevision
        ? { "X-Moment-Revision": options.momentRevision }
        : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

describe("/api/moments/[id] optimistic concurrency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 428 after authentication/rate limiting when X-Moment-Revision is missing", async () => {
    const { client, from, rpc } = createConfiguredSupabaseClientDouble({
      rpcResults: [allowedMutation],
    });
    authenticateWith(client);

    const response = await PATCH(
      request("PATCH", { body: { title: "Changed" } }),
      context(),
    );

    expect(response.status).toBe(428);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRECONDITION_REQUIRED",
        message: "A current Moment revision is required.",
      },
    });
    expect(rpc).toHaveBeenCalledWith("consume_moment_api_rate_limit", {
      requested_bucket: "mutation",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not accept If-Match as a Moment revision precondition", async () => {
    const { client, from } = createConfiguredSupabaseClientDouble({
      rpcResults: [allowedMutation],
    });
    authenticateWith(client);

    const response = await PATCH(
      request("PATCH", {
        body: { title: "Changed" },
        ifMatch: '"1"',
      }),
      context(),
    );

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PRECONDITION_REQUIRED" },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['"1"', "0", "01", "1, 2", "9007199254740992"])(
    "returns 400 for malformed X-Moment-Revision %s",
    async (momentRevision) => {
      const { client, from } = createConfiguredSupabaseClientDouble({
        rpcResults: [allowedMutation],
      });
      authenticateWith(client);

      const response = await PATCH(
        request("PATCH", { body: { title: "Changed" }, momentRevision }),
        context(),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_PRECONDITION" },
      });
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("updates with the supplied revision and returns the incremented revision", async () => {
    const { client, rpc } = createConfiguredSupabaseClientDouble(
      {
        rpcResults: [
          allowedMutation,
          mutationResult("updated", updatedRow),
        ],
      },
      { data: row, error: null },
    );
    authenticateWith(client);

    const response = await PATCH(
      request("PATCH", {
        body: { title: "  A softer morning  ", mood: "loved" },
        momentRevision: "1",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      moment: {
        id,
        revision: 2,
        date: "Aug 29, 2026",
        dateTime: "2026-08-29T04:15:30Z",
        time: "4:15 AM",
        mood: "loved",
        title: "A softer morning",
        excerpt: "Sunlight crossed the room.",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "update_moment_if_revision", {
      requested_moment_id: id,
      requested_revision: 1,
      requested_title: "A softer morning",
      requested_description: "Sunlight crossed the room.",
      requested_mood: "loved",
      requested_moment_date: "2026-08-29",
      requested_image_path: null,
      requested_import_image_hash: null,
    });
  });

  it("returns 412 with the current Moment when PATCH loses its CAS", async () => {
    const current = { ...updatedRow, title: "Another tab won" };
    const { client, rpc } = createConfiguredSupabaseClientDouble(
      {
        rpcResults: [allowedMutation, mutationResult("conflict", current)],
      },
      { data: current, error: null },
    );
    authenticateWith(client);

    const response = await PATCH(
      request("PATCH", {
        body: { title: "My unsaved draft" },
        momentRevision: "1",
      }),
      context(),
    );

    expect(response.status).toBe(412);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "MOMENT_VERSION_CONFLICT",
        currentMoment: { revision: 2, title: "Another tab won" },
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "consume_moment_api_rate_limit", {
      requested_bucket: "mutation",
    });
  });

  it("returns one 200 winner and one application 412 for concurrent PATCH requests", async () => {
    let stored = { ...row };
    const sharedRpc = vi.fn(
      async (functionName: string, parameters: Record<string, unknown>) => {
        if (functionName === "consume_moment_api_rate_limit") {
          return allowedMutation;
        }

        if (functionName !== "update_moment_if_revision") {
          throw new Error(`Unexpected RPC ${functionName}`);
        }

        if (parameters.requested_revision !== stored.revision) {
          return mutationResult("conflict", stored);
        }

        stored = {
          ...stored,
          title: String(parameters.requested_title),
          updated_at: "2026-08-29T04:16:30.000Z",
          revision: stored.revision + 1,
        };
        return mutationResult("updated", stored);
      },
    );
    const first = createConfiguredSupabaseClientDouble(
      {},
      { data: row, error: null },
    );
    const second = createConfiguredSupabaseClientDouble(
      {},
      { data: row, error: null },
    );
    Object.assign(first.client, { rpc: sharedRpc });
    Object.assign(second.client, { rpc: sharedRpc });
    createAuthenticatedClientMock
      .mockResolvedValueOnce({ client: first.client, userId: "user_a" })
      .mockResolvedValueOnce({ client: second.client, userId: "user_a" });

    const responses = await Promise.all([
      PATCH(
        request("PATCH", {
          body: { title: "PATCH writer one" },
          momentRevision: "1",
        }),
        context(),
      ),
      PATCH(
        request("PATCH", {
          body: { title: "PATCH writer two" },
          momentRevision: "1",
        }),
        context(),
      ),
    ]);
    const results = await Promise.all(
      responses.map(async (response) => ({
        body: await response.json(),
        status: response.status,
      })),
    );

    expect(results.map(({ status }) => status).sort()).toEqual([200, 412]);
    const winner = results.find(({ status }) => status === 200);
    const loser = results.find(({ status }) => status === 412);
    expect(winner?.body).toMatchObject({
      moment: { revision: 2, title: stored.title },
    });
    expect(loser?.body).toMatchObject({
      error: {
        code: "MOMENT_VERSION_CONFLICT",
        currentMoment: { revision: 2, title: stored.title },
      },
    });
    expect(stored.revision).toBe(2);
  });

  it("uploads an immutable replacement before its row CAS and cleans the old path", async () => {
    const generation = "70000000-0000-4000-8000-000000000001";
    const oldPath = `user_a/${id}/image`;
    const nextPath = `user_a/${id}/${generation}`;
    const imageRow = { ...row, image_path: oldPath };
    const nextRow = {
      ...updatedRow,
      image_path: nextPath,
      import_image_hash: null,
    };
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generation);
    const { client, rpc } = createConfiguredSupabaseClientDouble(
      {
        rpcResults: [
          allowedMutation,
          {
            data: [
              { outcome: "authorized", moment: imageRow, cleanup_path: nextPath },
            ],
            error: null,
          },
          mutationResult("updated", nextRow, oldPath),
          { data: [{ outcome: "completed" }], error: null },
        ],
      },
      { data: imageRow, error: null },
    );
    const bucket = addStorage(client);
    authenticateWith(client);
    const form = new FormData();
    form.set("title", "A softer morning");
    form.set("mood", "loved");
    form.set("imageAction", "replace");
    form.set(
      "image",
      new File(
        [
          new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45,
            0x42, 0x50,
          ]),
        ],
        "replacement.webp",
        { type: "image/webp" },
      ),
    );

    const response = await PATCH(multipartRequest(form), context());

    expect(response.status).toBe(200);
    expect(bucket.upload).toHaveBeenCalledWith(
      nextPath,
      expect.any(File),
      expect.objectContaining({ upsert: false }),
    );
    expect(bucket.remove).toHaveBeenCalledWith([oldPath]);
    expect(rpc).toHaveBeenNthCalledWith(2, "authorize_moment_image_candidate", {
      requested_moment_id: id,
      requested_revision: 1,
      requested_image_path: nextPath,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "update_moment_if_revision", {
      requested_moment_id: id,
      requested_revision: 1,
      requested_title: "A softer morning",
      requested_description: row.description,
      requested_mood: "loved",
      requested_moment_date: row.moment_date,
      requested_image_path: nextPath,
      requested_import_image_hash: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(4, "complete_moment_image_cleanup", {
      requested_image_path: oldPath,
    });
  });

  it("keeps the existing 404 contract for an RLS-hidden PATCH target", async () => {
    const { client } = createConfiguredSupabaseClientDouble(
      { rpcResults: [allowedMutation] },
      { data: null, error: null },
    );
    authenticateWith(client);

    const response = await PATCH(
      request("PATCH", {
        body: { title: "A different title" },
        momentRevision: "1",
      }),
      context(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("deletes by revision and returns the existing 204 contract", async () => {
    const { client, rpc } = createConfiguredSupabaseClientDouble(
      { rpcResults: [allowedMutation, mutationResult("deleted", row)] },
      { data: row, error: null },
    );
    authenticateWith(client);

    const response = await DELETE(
      request("DELETE", { momentRevision: "1" }),
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_moment_if_revision", {
      requested_moment_id: id,
      requested_revision: 1,
    });
  });

  it("returns 412 and leaves the card data available when DELETE is stale", async () => {
    const current = { ...updatedRow, title: "Updated elsewhere" };
    const { client } = createConfiguredSupabaseClientDouble(
      { rpcResults: [allowedMutation, mutationResult("conflict", current)] },
      { data: current, error: null },
    );
    authenticateWith(client);

    const response = await DELETE(
      request("DELETE", { momentRevision: "1" }),
      context(),
    );

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "MOMENT_VERSION_CONFLICT",
        currentMoment: { revision: 2, title: "Updated elsewhere" },
      },
    });
  });

  it("keeps missing/RLS-hidden DELETE targets at 404", async () => {
    const { client } = createConfiguredSupabaseClientDouble({
      rpcResults: [allowedMutation, mutationResult("not_found", null)],
    });
    authenticateWith(client);

    const response = await DELETE(
      request("DELETE", { momentRevision: "1" }),
      context(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when the delete RPC loses a concurrent DELETE after the owner lookup", async () => {
    const { client, rpc } = createConfiguredSupabaseClientDouble(
      { rpcResults: [allowedMutation, mutationResult("not_found", null)] },
      { data: row, error: null },
    );
    authenticateWith(client);

    const response = await DELETE(
      request("DELETE", { momentRevision: "1" }),
      context(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_moment_if_revision", {
      requested_moment_id: id,
      requested_revision: 1,
    });
  });

  it("authenticates before parsing or consuming a precondition", async () => {
    createAuthenticatedClientMock.mockRejectedValue(
      new SupabaseAuthenticationError(
        "Authentication is required to access Supabase.",
      ),
    );

    const response = await DELETE(request("DELETE"), context());

    expect(response.status).toBe(401);
  });
});
