import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import { SupabaseAuthenticationError } from "@/lib/supabase/server";
import { createSupabaseClientDouble } from "@/test/supabase-query-double";

const { createAuthenticatedClientMock } = vi.hoisted(() => ({
  createAuthenticatedClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createAuthenticatedSupabaseClient: createAuthenticatedClientMock,
}));

import { GET, POST } from "./route";

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  owner_id: "user_a",
  title: "A quiet morning",
  description: "Sunlight crossed the room.",
  mood: "calm",
  moment_date: "2026-08-29",
  image_path: null,
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

function authenticateWith(client: object) {
  createAuthenticatedClientMock.mockResolvedValue({
    client,
    userId: "user_a",
  });
}

describe("/api/moments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when Clerk has no authenticated session", async () => {
    createAuthenticatedClientMock.mockRejectedValue(
      new SupabaseAuthenticationError(
        "Authentication is required to access Supabase.",
      ),
    );

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
      },
    });
  });

  it("lists only the Moments visible through the authenticated client", async () => {
    const { client } = createSupabaseClientDouble({ data: [row], error: null });
    authenticateWith(client);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ moments: [moment] });
  });

  it("creates a validated Moment and returns the database-owned record", async () => {
    const { client, queries } = createSupabaseClientDouble({
      data: row,
      error: null,
    });
    authenticateWith(client);
    const request = new Request("http://localhost/api/moments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "  A quiet morning  ",
        description: "  Sunlight crossed the room.  ",
        mood: "calm",
        date: "2026-08-29",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ moment });
    expect(queries[0]?.insert).toHaveBeenCalledWith({
      title: "A quiet morning",
      description: "Sunlight crossed the room.",
      mood: "calm",
      moment_date: "2026-08-29",
    });
  });

  it("rejects malformed JSON", async () => {
    const { client } = createSupabaseClientDouble();
    authenticateWith(client);
    const request = new Request("http://localhost/api/moments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_JSON", message: "Request body must be valid JSON." },
    });
  });

  it("rejects client-provided owner identity before persistence", async () => {
    const { client, from } = createSupabaseClientDouble();
    authenticateWith(client);
    const request = new Request("http://localhost/api/moments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "A quiet morning",
        description: "Sunlight crossed the room.",
        mood: "calm",
        date: "2026-08-29",
        owner_id: "user_b",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Moment details are invalid.",
        fields: { request: "Request body contains unsupported fields." },
      },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not expose Supabase failure details", async () => {
    const { client } = createSupabaseClientDouble({
      data: null,
      error: { message: "sensitive database detail" },
    });
    authenticateWith(client);

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The Moment service is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});
