import type { MoodId } from "@/data/moments";
import { MAX_MOMENT_IMAGE_BYTES } from "@/lib/moment-image-validation";

export const MAX_LEGACY_IMPORT_ITEMS = 500;
export const MAX_LEGACY_SOURCE_CHARACTERS = 10_000_000;

export type LegacySkipReason =
  | "NOT_AN_OBJECT"
  | "INVALID_SOURCE_ID"
  | "DUPLICATE_SOURCE_ID"
  | "INVALID_TITLE"
  | "INVALID_DESCRIPTION"
  | "INVALID_MOOD"
  | "INVALID_DATE_TIME";

export type LegacyImageIssue =
  | "INVALID_IMAGE_DATA"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_SIGNATURE_MISMATCH";

export type LegacyImportCandidate = {
  sourceId: string;
  sourceHash: string;
  localRecordHash: string;
  sourceIndex: number;
  title: string;
  description: string;
  mood: MoodId;
  date: string;
  time: string;
  image: File | null;
  imageIssue: LegacyImageIssue | null;
};

export type LegacySkippedItem = {
  sourceIndex: number;
  sourceId?: string;
  title: string;
  reason: LegacySkipReason;
};

export type LegacyInspection =
  | {
      kind: "ready";
      candidates: LegacyImportCandidate[];
      skipped: LegacySkippedItem[];
    }
  | {
      kind: "error";
      reason:
        | "INVALID_JSON"
        | "ROOT_NOT_ARRAY"
        | "SOURCE_TOO_LARGE"
        | "TOO_MANY_ITEMS";
    };

const allowedMoods = new Set<MoodId>([
  "happy",
  "calm",
  "loved",
  "sad",
  "angry",
  "tired",
]);

const imageTypeDetails = {
  "image/jpeg": { extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": {
    extension: "png",
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  "image/webp": { extension: "webp", signature: [0x52, 0x49, 0x46, 0x46] },
} as const;

type SupportedImageType = keyof typeof imageTypeDetails;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizedDateTime(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/,
  );
  if (!match || !validDate(match[1]!)) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { date: match[1]!, time: `${match[2]}:${match[3]}:${match[4]}` };
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function canonicalLegacyMomentValue(value: {
  sourceId: string;
  title: string;
  description: string;
  mood: MoodId;
  date: string;
  time: string;
}) {
  return JSON.stringify({
    version: 1,
    sourceId: value.sourceId,
    title: value.title,
    description: value.description,
    mood: value.mood,
    date: value.date,
    time: value.time,
  });
}

function matchingImageSignature(bytes: Uint8Array, type: SupportedImageType) {
  const signature = imageTypeDetails[type].signature;
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  if (type !== "image/webp") return true;
  return (
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function decodeLegacyImage(value: unknown): {
  image: File | null;
  issue: LegacyImageIssue | null;
} {
  if (value === undefined) return { image: null, issue: null };
  if (!isObject(value) || typeof value.src !== "string") {
    return { image: null, issue: "INVALID_IMAGE_DATA" };
  }

  const header = value.src.match(/^data:([^;,]+);base64,(.*)$/);
  if (!header) return { image: null, issue: "INVALID_IMAGE_DATA" };
  const type = header[1]!;
  if (!Object.hasOwn(imageTypeDetails, type)) {
    return { image: null, issue: "UNSUPPORTED_IMAGE_TYPE" };
  }

  const encoded = header[2]!;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    return { image: null, issue: "INVALID_IMAGE_DATA" };
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedSize = (encoded.length / 4) * 3 - padding;
  if (decodedSize <= 0) return { image: null, issue: "INVALID_IMAGE_DATA" };
  if (decodedSize > MAX_MOMENT_IMAGE_BYTES) {
    return { image: null, issue: "IMAGE_TOO_LARGE" };
  }

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const supportedType = type as SupportedImageType;
    if (!matchingImageSignature(bytes, supportedType)) {
      return { image: null, issue: "IMAGE_SIGNATURE_MISMATCH" };
    }
    const extension = imageTypeDetails[supportedType].extension;
    return {
      image: new File([bytes], `legacy-moment-image.${extension}`, { type }),
      issue: null,
    };
  } catch {
    return { image: null, issue: "INVALID_IMAGE_DATA" };
  }
}

function fallbackTitle(value: unknown, index: number) {
  if (isObject(value) && typeof value.title === "string" && value.title.trim()) {
    return value.title.trim();
  }
  return `Legacy Moment ${index + 1}`;
}

export async function inspectLegacyMomentValue(raw: string): Promise<LegacyInspection> {
  if (raw.length > MAX_LEGACY_SOURCE_CHARACTERS) {
    return { kind: "error", reason: "SOURCE_TOO_LARGE" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "error", reason: "INVALID_JSON" };
  }
  if (!Array.isArray(parsed)) return { kind: "error", reason: "ROOT_NOT_ARRAY" };
  if (parsed.length > MAX_LEGACY_IMPORT_ITEMS) {
    return { kind: "error", reason: "TOO_MANY_ITEMS" };
  }

  const ids = new Map<string, number>();
  for (const value of parsed) {
    if (isObject(value) && typeof value.id === "string") {
      const id = value.id.trim();
      if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    }
  }

  const candidates: LegacyImportCandidate[] = [];
  const skipped: LegacySkippedItem[] = [];

  for (const [sourceIndex, value] of parsed.entries()) {
    const title = fallbackTitle(value, sourceIndex);
    if (!isObject(value)) {
      skipped.push({ sourceIndex, title, reason: "NOT_AN_OBJECT" });
      continue;
    }
    const sourceId = typeof value.id === "string" ? value.id.trim() : "";
    const skip = (reason: LegacySkipReason) =>
      skipped.push({
        sourceIndex,
        ...(sourceId ? { sourceId } : {}),
        title,
        reason,
      });
    if (!sourceId || sourceId.length > 255) {
      skip("INVALID_SOURCE_ID");
      continue;
    }
    if ((ids.get(sourceId) ?? 0) > 1) {
      skip("DUPLICATE_SOURCE_ID");
      continue;
    }
    const normalizedTitle = typeof value.title === "string" ? value.title.trim() : "";
    if (!normalizedTitle || normalizedTitle.length > 80) {
      skip("INVALID_TITLE");
      continue;
    }
    const description = typeof value.excerpt === "string" ? value.excerpt.trim() : "";
    if (!description || description.length > 280) {
      skip("INVALID_DESCRIPTION");
      continue;
    }
    if (typeof value.mood !== "string" || !allowedMoods.has(value.mood as MoodId)) {
      skip("INVALID_MOOD");
      continue;
    }
    const dateTime = normalizedDateTime(value.dateTime);
    if (!dateTime) {
      skip("INVALID_DATE_TIME");
      continue;
    }
    const normalized = {
      sourceId,
      title: normalizedTitle,
      description,
      mood: value.mood as MoodId,
      date: dateTime.date,
      time: dateTime.time,
    };
    const decodedImage = decodeLegacyImage(value.image);
    candidates.push({
      ...normalized,
      sourceHash: await sha256Text(canonicalLegacyMomentValue(normalized)),
      localRecordHash: await sha256Text(JSON.stringify(value)),
      sourceIndex,
      image: decodedImage.image,
      imageIssue: decodedImage.issue,
    });
  }

  return { kind: "ready", candidates, skipped };
}
