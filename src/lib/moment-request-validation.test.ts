import { describe, expect, it } from "vitest";

import {
  parseCreateMomentFormData,
  parseCreateMomentRequest,
  parseUpdateMomentFormData,
  parseUpdateMomentRequest,
} from "./moment-request-validation";

function pngFile(name = "memory.png") {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    name,
    { type: "image/png" },
  );
}

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

describe("parseCreateMomentFormData", () => {
  it("parses text fields and a server-validated image", async () => {
    const formData = new FormData();
    formData.set("title", "  A quiet morning  ");
    formData.set("description", "  Sunlight crossed the room.  ");
    formData.set("mood", "calm");
    formData.set("date", "2026-08-29");
    formData.set("image", pngFile());

    const result = await parseCreateMomentFormData(formData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.input).toEqual({
        title: "A quiet morning",
        description: "Sunlight crossed the room.",
        mood: "calm",
        date: "2026-08-29",
      });
      expect(result.data.image).toBeInstanceOf(File);
    }
  });

  it("rejects owner IDs, paths, and duplicate fields", async () => {
    const formData = new FormData();
    formData.set("title", "A quiet morning");
    formData.append("title", "A different title");
    formData.set("description", "Sunlight crossed the room.");
    formData.set("mood", "calm");
    formData.set("date", "2026-08-29");
    formData.set("owner_id", "user_b");
    formData.set("image_path", "user_b/a/path");

    await expect(parseCreateMomentFormData(formData)).resolves.toEqual({
      success: false,
      errors: { request: "Request body contains unsupported or duplicate fields." },
    });
  });
});

describe("parseUpdateMomentFormData", () => {
  it("accepts an image-only replacement", async () => {
    const formData = new FormData();
    formData.set("imageAction", "replace");
    formData.set("image", pngFile());

    const result = await parseUpdateMomentFormData(formData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.input).toEqual({});
      expect(result.data.imageMutation.kind).toBe("replace");
    }
  });

  it("accepts image removal without text changes", async () => {
    const formData = new FormData();
    formData.set("imageAction", "remove");

    await expect(parseUpdateMomentFormData(formData)).resolves.toEqual({
      success: true,
      data: {
        input: {},
        imageMutation: { kind: "remove" },
      },
    });
  });

  it("requires a valid image for replacement", async () => {
    const formData = new FormData();
    formData.set("imageAction", "replace");
    formData.set(
      "image",
      new File([new Uint8Array([0x47, 0x49, 0x46])], "spoofed.png", {
        type: "image/png",
      }),
    );

    await expect(parseUpdateMomentFormData(formData)).resolves.toEqual({
      success: false,
      errors: { image: "The image contents do not match its file type." },
    });
  });

  it("rejects arbitrary image paths", async () => {
    const formData = new FormData();
    formData.set("imageAction", "remove");
    formData.set("image_path", "user_b/other/image");

    await expect(parseUpdateMomentFormData(formData)).resolves.toEqual({
      success: false,
      errors: { request: "Request body contains unsupported or duplicate fields." },
    });
  });
});
