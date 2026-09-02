import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseAuthenticationError } from "@/lib/supabase/server";
import { createSupabaseClientDouble } from "@/test/supabase-query-double";

const { createAuthenticatedClientMock } = vi.hoisted(() => ({
  createAuthenticatedClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createAuthenticatedSupabaseClient: createAuthenticatedClientMock,
}));

import { GET } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const imagePath = `user_a/${id}/image`;
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
  image_path: imagePath,
  created_at: "2026-08-29T04:15:30.000Z",
  updated_at: "2026-08-29T04:15:30.000Z",
  revision: 1,
};

function context(momentId = id) {
  return { params: Promise.resolve({ id: momentId }) };
}

function authenticateWith(client: object, userId = "user_a") {
  createAuthenticatedClientMock.mockResolvedValue({ client, userId });
}

function addStorage(client: object) {
  const blob = new Blob(["private image"], { type: "image/png" });
  const download = vi.fn().mockResolvedValue({ data: blob, error: null });
  Object.assign(client, {
    storage: { from: vi.fn().mockReturnValue({ download }) },
  });

  return { blob, download };
}

describe("GET /api/moments/[id]/image", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires Clerk authentication", async () => {
    createAuthenticatedClientMock.mockRejectedValue(
      new SupabaseAuthenticationError(
        "Authentication is required to access Supabase.",
      ),
    );

    const response = await GET(
      new Request(`http://localhost/api/moments/${id}/image`),
      context(),
    );

    expect(response.status).toBe(401);
  });

  it("streams an owned image privately with nosniff protection", async () => {
    const { client, rpc } = createSupabaseClientDouble({
      data: row,
      error: null,
    });
    const { blob, download } = addStorage(client);
    authenticateWith(client);

    const response = await GET(
      new Request(`http://localhost/api/moments/${id}/image`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.blob()).toEqual(blob);
    expect(download).toHaveBeenCalledWith(
      imagePath,
      { cacheNonce: expect.any(String) },
      { cache: "no-store" },
    );
    expect(rpc).toHaveBeenCalledWith("consume_moment_api_rate_limit", {
      requested_bucket: "read",
    });
  });

  it("returns the same 404 when RLS hides another user's Moment", async () => {
    const { client } = createSupabaseClientDouble({ data: null, error: null });
    const { download } = addStorage(client);
    authenticateWith(client, "user_a");

    const response = await GET(
      new Request(`http://localhost/api/moments/${id}/image`),
      context(),
    );

    expect(response.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("rejects an invalid Moment id before Storage access", async () => {
    const { client } = createSupabaseClientDouble();
    const { download } = addStorage(client);
    authenticateWith(client);

    const response = await GET(
      new Request("http://localhost/api/moments/not-a-uuid/image"),
      context("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(download).not.toHaveBeenCalled();
  });
});
