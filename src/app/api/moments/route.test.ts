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
  moment_time: null,
  import_source: null,
  import_source_id: null,
  import_source_hash: null,
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

function addStorage(client: object) {
  const bucket = {
    download: vi.fn(),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn(),
    upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
  const from = vi.fn().mockReturnValue(bucket);
  Object.assign(client, { storage: { from } });

  return { bucket, from };
}

function validPng() {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "memory.png",
    { type: "image/png" },
  );
}

function multipartRequest(formData: FormData) {
  const request = new Request("http://localhost/api/moments", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
  });
  vi.spyOn(request, "formData").mockResolvedValue(formData);

  return request;
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

  it("uploads a validated image to the server-constructed private path", async () => {
    const imagePath = `user_a/${row.id}/image`;
    const imageRow = { ...row, image_path: imagePath };
    const { client, queries } = createSupabaseClientDouble(
      { data: row, error: null },
      { data: imageRow, error: null },
    );
    const { bucket, from } = addStorage(client);
    authenticateWith(client);
    const formData = new FormData();
    formData.set("title", "A quiet morning");
    formData.set("description", "Sunlight crossed the room.");
    formData.set("mood", "calm");
    formData.set("date", "2026-08-29");
    formData.set("image", validPng());
    const request = multipartRequest(formData);

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      moment: {
        ...moment,
        image: {
          src: `/api/moments/${row.id}/image`,
          alt: "A quiet morning moment image.",
        },
      },
    });
    expect(from).toHaveBeenCalledWith("moment-images");
    expect(bucket.upload).toHaveBeenCalledWith(
      imagePath,
      expect.any(File),
      expect.objectContaining({ contentType: "image/png", upsert: false }),
    );
    expect(queries[1]!.update).toHaveBeenCalledWith(
      expect.objectContaining({ image_path: imagePath }),
    );
  });

  it("rejects a multipart image whose declared type does not match its bytes", async () => {
    const { client, from } = createSupabaseClientDouble();
    addStorage(client);
    authenticateWith(client);
    const formData = new FormData();
    formData.set("title", "A quiet morning");
    formData.set("description", "Sunlight crossed the room.");
    formData.set("mood", "calm");
    formData.set("date", "2026-08-29");
    formData.set(
      "image",
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "spoof.png", {
        type: "image/png",
      }),
    );

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Moment details are invalid.",
        fields: { image: "The image contents do not match its file type." },
      },
    });
    expect(from).not.toHaveBeenCalled();
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
