import { describe, expect, it } from "vitest";

import {
  inspectLegacyMomentValue,
  MAX_LEGACY_IMPORT_ITEMS,
  MAX_LEGACY_SOURCE_CHARACTERS,
} from "./legacy-moment-import";

const validMoment = {
  id: "legacy-1",
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:30",
  time: "9:15 AM",
  mood: "calm",
  title: " A quiet beginning ",
  excerpt: " The room felt peaceful. ",
};

describe("inspectLegacyMomentValue", () => {
  it("normalizes a valid legacy Moment without trusting display caches", async () => {
    const result = await inspectLegacyMomentValue(JSON.stringify([validMoment]));

    expect(result).toMatchObject({
      kind: "ready",
      candidates: [
        {
          sourceId: "legacy-1",
          title: "A quiet beginning",
          description: "The room felt peaceful.",
          mood: "calm",
          date: "2026-08-28",
          time: "09:15:30",
          image: null,
          imageIssue: null,
          sourceIndex: 0,
        },
      ],
      skipped: [],
    });
    expect(result.kind === "ready" && result.candidates[0]?.sourceHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      result.kind === "ready" && result.candidates[0]?.localRecordHash,
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it("classifies malformed records independently and skips every duplicate id", async () => {
    const result = await inspectLegacyMomentValue(
      JSON.stringify([
        validMoment,
        { ...validMoment, id: "legacy-2", mood: "uncertain" },
        { ...validMoment, title: "Second copy" },
        "not-an-object",
      ]),
    );

    expect(result).toEqual({
      kind: "ready",
      candidates: [],
      skipped: [
        {
          reason: "DUPLICATE_SOURCE_ID",
          sourceId: "legacy-1",
          sourceIndex: 0,
          title: "A quiet beginning",
        },
        {
          reason: "INVALID_MOOD",
          sourceId: "legacy-2",
          sourceIndex: 1,
          title: "A quiet beginning",
        },
        {
          reason: "DUPLICATE_SOURCE_ID",
          sourceId: "legacy-1",
          sourceIndex: 2,
          title: "Second copy",
        },
        {
          reason: "NOT_AN_OBJECT",
          sourceIndex: 3,
          title: "Legacy Moment 4",
        },
      ],
    });
  });

  it("decodes a signature-valid image into a File", async () => {
    const result = await inspectLegacyMomentValue(
      JSON.stringify([
        {
          ...validMoment,
          image: {
            src: "data:image/png;base64,iVBORw0KGgo=",
            alt: "Legacy description",
          },
        },
      ]),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.candidates[0]?.image).toBeInstanceOf(File);
    expect(result.candidates[0]?.image).toMatchObject({
      name: "legacy-moment-image.png",
      size: 8,
      type: "image/png",
    });
    expect(result.candidates[0]?.imageIssue).toBeNull();
  });

  it.each([
    ["unsupported type", "data:image/gif;base64,R0lGODlh", "UNSUPPORTED_IMAGE_TYPE"],
    ["malformed base64", "data:image/png;base64,not*base64", "INVALID_IMAGE_DATA"],
    ["wrong signature", "data:image/png;base64,aW1hZ2U=", "IMAGE_SIGNATURE_MISMATCH"],
  ])("keeps the core importable when the image has %s", async (_name, src, reason) => {
    const result = await inspectLegacyMomentValue(
      JSON.stringify([{ ...validMoment, image: { src, alt: "Legacy" } }]),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.candidates[0]).toMatchObject({
      image: null,
      imageIssue: reason,
      sourceId: "legacy-1",
    });
  });

  it("rejects oversized images without allocating decoded bytes", async () => {
    const oversizedBase64 = "A".repeat(1_333_336);
    const result = await inspectLegacyMomentValue(
      JSON.stringify([
        {
          ...validMoment,
          image: { src: `data:image/jpeg;base64,${oversizedBase64}` },
        },
      ]),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.candidates[0]?.imageIssue).toBe("IMAGE_TOO_LARGE");
  });

  it("returns source-level errors without throwing or mutating input", async () => {
    const malformed = "{not-json";

    await expect(inspectLegacyMomentValue(malformed)).resolves.toEqual({
      kind: "error",
      reason: "INVALID_JSON",
    });
    await expect(inspectLegacyMomentValue(JSON.stringify({}))).resolves.toEqual({
      kind: "error",
      reason: "ROOT_NOT_ARRAY",
    });
    await expect(
      inspectLegacyMomentValue("x".repeat(MAX_LEGACY_SOURCE_CHARACTERS + 1)),
    ).resolves.toEqual({ kind: "error", reason: "SOURCE_TOO_LARGE" });
    await expect(
      inspectLegacyMomentValue(
        JSON.stringify(Array.from({ length: MAX_LEGACY_IMPORT_ITEMS + 1 }, () => null)),
      ),
    ).resolves.toEqual({ kind: "error", reason: "TOO_MANY_ITEMS" });
  });
});
