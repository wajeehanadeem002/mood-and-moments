import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import { LegacyImportSourceConflictError } from "@/lib/authenticated-moment-import-service";
import { SupabaseAuthenticationError } from "@/lib/supabase/server";

const importMoment = vi.hoisted(() => vi.fn());
const createAuthenticatedMomentImportService = vi.hoisted(() =>
  vi.fn(async () => ({ import: importMoment })),
);

vi.mock("@/lib/moment-api-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/moment-api-server")>()),
  createAuthenticatedMomentImportService,
}));

import { POST } from "./route";

const savedMoment: Moment = {
  id: "00000000-0000-4000-8000-000000000001",
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:30",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful.",
};

function formRequest(
  withImage = false,
  mutate?: (form: FormData) => void,
) {
  const form = new FormData();
  form.set("sourceId", "legacy-1");
  form.set("title", "A quiet beginning");
  form.set("description", "The room felt peaceful.");
  form.set("mood", "calm");
  form.set("date", "2026-08-28");
  form.set("time", "09:15:30");
  if (withImage) {
    form.set(
      "image",
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        "legacy.png",
        { type: "image/png" },
      ),
    );
  }
  mutate?.(form);
  const request = new Request("http://localhost/api/moments/import", {
    headers: { "content-type": "multipart/form-data; boundary=test" },
    method: "POST",
  });
  vi.spyOn(request, "formData").mockResolvedValue(form);

  return request;
}

describe("POST /api/moments/import", () => {
  beforeEach(() => {
    importMoment.mockReset();
    createAuthenticatedMomentImportService.mockReset();
    createAuthenticatedMomentImportService.mockResolvedValue({ import: importMoment });
    importMoment.mockResolvedValue({
      outcome: "created",
      imageOutcome: "not_provided",
      sourceId: "legacy-1",
      sourceHash: "f3a1420b514b3e08de201fb0041856c68f96cf0469a3781ba5e20933997e5f63",
      moment: savedMoment,
    });
  });

  it("authenticates before accepting the import", async () => {
    createAuthenticatedMomentImportService.mockRejectedValue(
      new SupabaseAuthenticationError(
        "Authentication is required to access Supabase.",
      ),
    );

    const response = await POST(formRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication is required." },
    });
    expect(importMoment).not.toHaveBeenCalled();
  });

  it("rejects non-multipart requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/moments/import", {
        body: JSON.stringify({ ownerId: "user_a" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_FORM_DATA",
        message: "Request body must be valid multipart form data.",
      },
    });
  });

  it("computes source identity on the server and returns a created result", async () => {
    const response = await POST(formRequest(true));

    const body = await response.json();
    expect(body).toEqual({
      result: {
        outcome: "created",
        imageOutcome: "not_provided",
        sourceId: "legacy-1",
        sourceHash: "f3a1420b514b3e08de201fb0041856c68f96cf0469a3781ba5e20933997e5f63",
        moment: savedMoment,
      },
    });
    expect(response.status).toBe(201);
    expect(importMoment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        title: "A quiet beginning",
        excerpt: "The room felt peaceful.",
        mood: "calm",
        dateTime: expect.stringMatching(/^2026-08-28T/),
      }),
      {
        sourceId: "legacy-1",
        sourceHash: "f3a1420b514b3e08de201fb0041856c68f96cf0469a3781ba5e20933997e5f63",
        time: "09:15:30",
      },
      expect.objectContaining({ type: "image/png", size: 8 }),
    );
  });

  it("returns idempotent imports with status 200", async () => {
    importMoment.mockResolvedValue({
      outcome: "already_imported",
      imageOutcome: "not_provided",
      sourceId: "legacy-1",
      sourceHash: "f3a1420b514b3e08de201fb0041856c68f96cf0469a3781ba5e20933997e5f63",
      moment: savedMoment,
    });

    const response = await POST(formRequest());
    expect(response.status).toBe(200);
  });

  it("returns an image mismatch as an explicit non-created result", async () => {
    importMoment.mockResolvedValue({
      outcome: "image_mismatch",
      imageOutcome: "mismatch",
      sourceId: "legacy-1",
      sourceHash:
        "f3a1420b514b3e08de201fb0041856c68f96cf0469a3781ba5e20933997e5f63",
      moment: savedMoment,
    });

    const response = await POST(formRequest(true));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { outcome: "image_mismatch", imageOutcome: "mismatch" },
    });
  });

  it("returns a conflict without modifying an existing import", async () => {
    importMoment.mockRejectedValue(new LegacyImportSourceConflictError());

    const response = await POST(formRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "IMPORT_SOURCE_CONFLICT",
        message: "This legacy Moment changed after it was imported.",
      },
    });
  });

  it("rejects a caller-supplied import image digest", async () => {
    const response = await POST(
      formRequest(true, (form) => form.set("import_image_hash", "a".repeat(64))),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fields: { request: expect.any(String) },
      },
    });
    expect(importMoment).not.toHaveBeenCalled();
  });
});
