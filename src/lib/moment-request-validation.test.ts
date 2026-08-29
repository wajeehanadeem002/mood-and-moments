import { describe, expect, it } from "vitest";

import {
  parseCreateMomentRequest,
  parseUpdateMomentRequest,
} from "./moment-request-validation";

describe("parseCreateMomentRequest", () => {
  it("normalizes a valid create payload", () => {
    expect(
      parseCreateMomentRequest({
        title: "  A quiet morning  ",
        description: "  Sunlight crossed the room.  ",
        mood: "calm",
        date: "2026-08-29",
      }),
    ).toEqual({
      success: true,
      data: {
        title: "A quiet morning",
        description: "Sunlight crossed the room.",
        mood: "calm",
        date: "2026-08-29",
      },
    });
  });

  it.each([null, [], "not-an-object", 42])(
    "rejects a non-object request body: %j",
    (body) => {
      expect(parseCreateMomentRequest(body)).toEqual({
        success: false,
        errors: { request: "Request body must be a JSON object." },
      });
    },
  );

  it("rejects identity, image, and other unsupported fields", () => {
    expect(
      parseCreateMomentRequest({
        title: "A quiet morning",
        description: "Sunlight crossed the room.",
        mood: "calm",
        date: "2026-08-29",
        owner_id: "user_b",
        image: "data:image/png;base64,unsafe",
      }),
    ).toEqual({
      success: false,
      errors: { request: "Request body contains unsupported fields." },
    });
  });

  it("reports invalid required fields without coercing their values", () => {
    expect(
      parseCreateMomentRequest({
        title: 42,
        description: " ",
        mood: "excited",
        date: "2026-02-30",
      }),
    ).toEqual({
      success: false,
      errors: {
        title: "Give this moment a title.",
        description: "Describe the moment you want to remember.",
        mood: "Choose a supported mood.",
        date: "Choose a valid date.",
      },
    });
  });

  it("enforces the database text limits", () => {
    expect(
      parseCreateMomentRequest({
        title: "t".repeat(81),
        description: "d".repeat(281),
        mood: "loved",
        date: "2026-08-29",
      }),
    ).toEqual({
      success: false,
      errors: {
        title: "Keep the title to 80 characters or fewer.",
        description: "Keep the description to 280 characters or fewer.",
      },
    });
  });
});

describe("parseUpdateMomentRequest", () => {
  it("normalizes a valid partial update", () => {
    expect(
      parseUpdateMomentRequest({
        title: "  A softer memory  ",
        mood: "loved",
      }),
    ).toEqual({
      success: true,
      data: {
        title: "A softer memory",
        mood: "loved",
      },
    });
  });

  it("rejects an empty update", () => {
    expect(parseUpdateMomentRequest({})).toEqual({
      success: false,
      errors: { request: "Provide at least one Moment field to update." },
    });
  });

  it("validates only the fields supplied by a partial update", () => {
    expect(
      parseUpdateMomentRequest({
        title: " ",
        date: "August 29",
      }),
    ).toEqual({
      success: false,
      errors: {
        title: "Give this moment a title.",
        date: "Choose a valid date.",
      },
    });
  });

  it("rejects owner and identifier changes", () => {
    expect(
      parseUpdateMomentRequest({
        title: "A valid title",
        id: "00000000-0000-0000-0000-000000000001",
        ownerId: "user_b",
      }),
    ).toEqual({
      success: false,
      errors: { request: "Request body contains unsupported fields." },
    });
  });
});
