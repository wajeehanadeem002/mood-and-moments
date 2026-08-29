import { describe, expect, it } from "vitest";

import { validateMomentImageFile } from "./moment-image-validation";

const signatures = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ],
} as const;

function imageFile(bytes: readonly number[], type: string, name = "image") {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("validateMomentImageFile", () => {
  it.each([
    ["JPEG", signatures.jpeg, "image/jpeg"],
    ["PNG", signatures.png, "image/png"],
    ["WebP", signatures.webp, "image/webp"],
  ])("accepts a %s whose signature matches its MIME type", async (_, bytes, type) => {
    await expect(validateMomentImageFile(imageFile(bytes, type))).resolves.toEqual({
      success: true,
    });
  });

  it("rejects an unsupported declared MIME type", async () => {
    await expect(
      validateMomentImageFile(imageFile(signatures.png, "image/gif")),
    ).resolves.toEqual({
      success: false,
      error: "Choose a JPEG, PNG, or WebP image.",
    });
  });

  it("rejects a file larger than 1,000,000 bytes", async () => {
    const bytes = new Uint8Array(1_000_001);
    bytes.set(signatures.png);

    await expect(
      validateMomentImageFile(new File([bytes], "large.png", { type: "image/png" })),
    ).resolves.toEqual({
      success: false,
      error: "Keep the image at 1 MB or smaller.",
    });
  });

  it("rejects an empty file", async () => {
    await expect(
      validateMomentImageFile(new File([], "empty.png", { type: "image/png" })),
    ).resolves.toEqual({
      success: false,
      error: "Choose a valid JPEG, PNG, or WebP image.",
    });
  });

  it("rejects a spoofed MIME type whose signature does not match", async () => {
    await expect(
      validateMomentImageFile(imageFile(signatures.jpeg, "image/png")),
    ).resolves.toEqual({
      success: false,
      error: "The image contents do not match its file type.",
    });
  });
});
