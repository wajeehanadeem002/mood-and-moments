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

import { DELETE, PATCH } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const row = {
  id,
  owner_id: "user_a",
  title: "A quiet morning",
  description: "Sunlight crossed the room.",
  mood: "calm",
  moment_date: "2026-08-29",
  image_path: null,
  created_at: "2026-08-29T04:15:30.000Z",
  updated_at: "2026-08-29T04:15:30.000Z",
};

function context(momentId = id) {
  return { params: Promise.resolve({ id: momentId }) };
}

function authenticateWith(client: object) {
  createAuthenticatedClientMock.mockResolvedValue({
    client,
    userId: "user_a",
  });
}

describe("/api/moments/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("partially updates an owned Moment", async () => {
    const updatedRow = {
      ...row,
      title: "A softer morning",
      mood: "loved",
    };
    const { client, queries } = createSupabaseClientDouble(
      { data: row, error: null },
      { data: updatedRow, error: null },
    );
    authenticateWith(client);
    const request = new Request(`http://localhost/api/moments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  A softer morning  ", mood: "loved" }),
    });

    const response = await PATCH(request, context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      moment: {
        id,
        date: "Aug 29, 2026",
        dateTime: "2026-08-29T04:15:30Z",
        time: "4:15 AM",
        mood: "loved",
        title: "A softer morning",
        excerpt: "Sunlight crossed the room.",
      },
    });
    expect(queries[1]?.update).toHaveBeenCalledWith({
      title: "A softer morning",
      description: "Sunlight crossed the room.",
      mood: "loved",
      moment_date: "2026-08-29",
    });
  });

  it("returns the same 404 for a missing or RLS-hidden Moment", async () => {
    const { client } = createSupabaseClientDouble({ data: null, error: null });
    authenticateWith(client);
    const request = new Request(`http://localhost/api/moments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "A different title" }),
    });

    const response = await PATCH(request, context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Moment not found." },
    });
  });

  it("rejects ownership transfer fields before updating", async () => {
    const { client, from } = createSupabaseClientDouble();
    authenticateWith(client);
    const request = new Request(`http://localhost/api/moments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "user_b" }),
    });

    const response = await PATCH(request, context());

    expect(response.status).toBe(422);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an invalid Moment identifier", async () => {
    const { client, from } = createSupabaseClientDouble();
    authenticateWith(client);
    const request = new Request("http://localhost/api/moments/not-a-uuid", {
      method: "DELETE",
    });

    const response = await DELETE(request, context("not-a-uuid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_ID", message: "Moment id is invalid." },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("deletes an owned Moment without returning a body", async () => {
    const { client, queries } = createSupabaseClientDouble({
      data: { id },
      error: null,
    });
    authenticateWith(client);
    const request = new Request(`http://localhost/api/moments/${id}`, {
      method: "DELETE",
    });

    const response = await DELETE(request, context());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
    expect(queries[0]?.eq).toHaveBeenCalledWith("id", id);
  });

  it("returns 404 when RLS prevents deleting the requested Moment", async () => {
    const { client } = createSupabaseClientDouble({ data: null, error: null });
    authenticateWith(client);
    const request = new Request(`http://localhost/api/moments/${id}`, {
      method: "DELETE",
    });

    const response = await DELETE(request, context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Moment not found." },
    });
  });

  it("requires Clerk authentication before attempting deletion", async () => {
    createAuthenticatedClientMock.mockRejectedValue(
      new SupabaseAuthenticationError(
        "Authentication is required to access Supabase.",
      ),
    );
    const request = new Request(`http://localhost/api/moments/${id}`, {
      method: "DELETE",
    });

    const response = await DELETE(request, context());

    expect(response.status).toBe(401);
  });
});
