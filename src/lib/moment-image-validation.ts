export const MAX_MOMENT_IMAGE_BYTES = 1_000_000;

export const supportedMomentImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedMomentImageType =
  (typeof supportedMomentImageTypes)[number];

export type MomentImageValidationResult =
  | { success: true }
  | { success: false; error: string };

const supportedTypes = new Set<string>(supportedMomentImageTypes);

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

function hasMatchingSignature(bytes: Uint8Array, type: string) {
  switch (type) {
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
    case "image/webp":
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

export async function validateMomentImageFile(
  file: File,
): Promise<MomentImageValidationResult> {
  if (!supportedTypes.has(file.type)) {
    return {
      success: false,
      error: "Choose a JPEG, PNG, or WebP image.",
    };
  }

  if (file.size > MAX_MOMENT_IMAGE_BYTES) {
    return {
      success: false,
      error: "Keep the image at 1 MB or smaller.",
    };
  }

  if (file.size === 0) {
    return {
      success: false,
      error: "Choose a valid JPEG, PNG, or WebP image.",
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!hasMatchingSignature(bytes, file.type)) {
    return {
      success: false,
      error: "The image contents do not match its file type.",
    };
  }

  return { success: true };
}

export async function sha256MomentImage(image: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await image.arrayBuffer());

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
