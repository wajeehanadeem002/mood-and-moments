import { describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";
import type { LegacyImportCandidate } from "@/lib/legacy-moment-import";

import {
  ApiLegacyMomentImportRepository,
  ApiLegacyMomentImportRepositoryError,
} from "./api-legacy-moment-import-repository";

const moment: Moment = {
  id: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:30",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful.",
};

const candidate: LegacyImportCandidate = {
  sourceId: "legacy-1",
  sourceHash: "f3a1420b514b3e08de201fb0041856c68f96cf0469a3781ba5e20933997e5f63",
  localRecordHash: "d".repeat(64),
  sourceIndex: 0,
  title: moment.title,
  description: moment.excerpt,
  mood: moment.mood,
  date: "2026-08-28",
  time: "09:15:30",
  image: new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "legacy.png",
    { type: "image/png" },
  ),
  imageIssue: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiLegacyMomentImportRepository", () => {
  it("submits only normalized legacy fields and an optional image", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          result: {
            outcome: "created",
            imageOutcome: "uploaded",
            sourceId: candidate.sourceId,
            sourceHash: candidate.sourceHash,
            moment: {
              ...moment,
              image: {
                src: `/api/moments/${moment.id}/image`,
                alt: "A quiet beginning moment image.",
              },
            },
          },
        },
        201,
      ),
    );
    const repository = new ApiLegacyMomentImportRepository(
      fetcher as typeof fetch,
    );

    await expect(repository.import(candidate)).resolves.toEqual(
      expect.objectContaining({
        outcome: "created",
        imageOutcome: "uploaded",
        sourceId: candidate.sourceId,
      }),
    );

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/moments/import");
    expect(init).toEqual(
      expect.objectContaining({
        headers: { Accept: "application/json" },
        method: "POST",
      }),
    );
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(Object.fromEntries(body.entries())).toEqual(
      expect.objectContaining({
        sourceId: "legacy-1",
        title: "A quiet beginning",
        description: "The room felt peaceful.",
        mood: "calm",
        date: "2026-08-28",
        time: "09:15:30",
        image: expect.objectContaining({ type: "image/png", size: 8 }),
      }),
    );
    expect(body.get("sourceHash")).toBeNull();
    expect(body.get("ownerId")).toBeNull();
    expect(body.get("id")).toBeNull();
    expect(body.get("imagePath")).toBeNull();
  });

  it("omits an invalid legacy image while preserving the core Moment", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          outcome: "created",
          imageOutcome: "not_provided",
          sourceId: candidate.sourceId,
          sourceHash: candidate.sourceHash,
          moment,
        },
      }),
    );
    const repository = new ApiLegacyMomentImportRepository(
      fetcher as typeof fetch,
    );

    await repository.import({
      ...candidate,
      image: null,
      imageIssue: "IMAGE_SIGNATURE_MISMATCH",
    });

    const body = fetcher.mock.calls[0]![1]!.body as FormData;
    expect(body.get("image")).toBeNull();
  });

  it("preserves structured conflict errors for per-item retry results", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "IMPORT_SOURCE_CONFLICT",
            message: "This legacy Moment changed after it was imported.",
          },
        },
        409,
      ),
    );
    const repository = new ApiLegacyMomentImportRepository(
      fetcher as typeof fetch,
    );

    await expect(repository.import(candidate)).rejects.toEqual(
      expect.objectContaining({
        name: "ApiLegacyMomentImportRepositoryError",
        status: 409,
        code: "IMPORT_SOURCE_CONFLICT",
      } satisfies Partial<ApiLegacyMomentImportRepositoryError>),
    );
  });

  it("accepts an explicit server image-mismatch result", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          outcome: "image_mismatch",
          imageOutcome: "mismatch",
          sourceId: candidate.sourceId,
          sourceHash: candidate.sourceHash,
          moment,
        },
      }),
    );
    const repository = new ApiLegacyMomentImportRepository(
      fetcher as typeof fetch,
    );

    await expect(repository.import(candidate)).resolves.toMatchObject({
      outcome: "image_mismatch",
      imageOutcome: "mismatch",
    });
  });

  it("fails closed on network and malformed success responses", async () => {
    const unavailable = new ApiLegacyMomentImportRepository(
      vi.fn().mockRejectedValue(new TypeError("offline")) as typeof fetch,
    );
    await expect(unavailable.import(candidate)).rejects.toEqual(
      expect.objectContaining({ code: "NETWORK_ERROR" }),
    );

    const malformed = new ApiLegacyMomentImportRepository(
      vi.fn().mockResolvedValue(jsonResponse({ result: {} })) as typeof fetch,
    );
    await expect(malformed.import(candidate)).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );

    const unversioned = new ApiLegacyMomentImportRepository(
      vi.fn().mockResolvedValue(
        jsonResponse({
          result: {
            outcome: "created",
            imageOutcome: "not_provided",
            sourceId: candidate.sourceId,
            sourceHash: candidate.sourceHash,
            moment: { ...moment, revision: undefined },
          },
        }),
      ) as typeof fetch,
    );
    await expect(unversioned.import(candidate)).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );

    const inconsistent = new ApiLegacyMomentImportRepository(
      vi.fn().mockResolvedValue(
        jsonResponse({
          result: {
            outcome: "already_imported",
            imageOutcome: "mismatch",
            sourceId: candidate.sourceId,
            sourceHash: candidate.sourceHash,
            moment,
          },
        }),
      ) as typeof fetch,
    );
    await expect(inconsistent.import(candidate)).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });
});
