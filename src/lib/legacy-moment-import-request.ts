import type { MomentRequestInput } from "@/lib/moment-request-validation";
import { parseCreateMomentRequest } from "@/lib/moment-request-validation";
import { validateMomentImageFile } from "@/lib/moment-image-validation";

export type LegacyMomentImportRequest = {
  sourceId: string;
  time: string;
  input: MomentRequestInput;
  image: File | null;
};

export type LegacyMomentImportRequestResult =
  | { success: true; data: LegacyMomentImportRequest }
  | { success: false; errors: Record<string, string> };

const allowedFields = new Set([
  "sourceId",
  "title",
  "description",
  "mood",
  "date",
  "time",
  "image",
]);

function isFile(value: FormDataEntryValue): value is File {
  return (
    typeof value !== "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
  );
}

function validTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  return (
    Boolean(match) &&
    Number(match?.[1]) <= 23 &&
    Number(match?.[2]) <= 59 &&
    Number(match?.[3]) <= 59
  );
}

export async function parseLegacyMomentImportFormData(
  formData: FormData,
): Promise<LegacyMomentImportRequestResult> {
  const values: Record<string, FormDataEntryValue> = {};
  for (const [field, value] of formData.entries()) {
    if (!allowedFields.has(field) || Object.hasOwn(values, field)) {
      return {
        success: false,
        errors: {
          request: "Request body contains unsupported or duplicate fields.",
        },
      };
    }
    values[field] = value;
  }

  const sourceId = typeof values.sourceId === "string" ? values.sourceId.trim() : "";
  if (!sourceId || sourceId.length > 255) {
    return {
      success: false,
      errors: { sourceId: "Choose a valid legacy source id." },
    };
  }

  const time = typeof values.time === "string" ? values.time : "";
  if (!validTime(time)) {
    return {
      success: false,
      errors: { time: "Choose a valid legacy Moment time." },
    };
  }

  const inputResult = parseCreateMomentRequest({
    title: values.title,
    description: values.description,
    mood: values.mood,
    date: values.date,
  });
  if (!inputResult.success) return inputResult;

  const image = values.image;
  if (image !== undefined && !isFile(image)) {
    return {
      success: false,
      errors: { image: "Choose a valid JPEG, PNG, or WebP image." },
    };
  }
  if (image && isFile(image)) {
    const validation = await validateMomentImageFile(image);
    if (!validation.success) {
      return { success: false, errors: { image: validation.error } };
    }
  }

  return {
    success: true,
    data: {
      sourceId,
      time,
      input: inputResult.data,
      image: image ?? null,
    },
  };
}
