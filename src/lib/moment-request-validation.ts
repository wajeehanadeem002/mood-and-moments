import type { MoodId } from "@/data/moments";
import { validateMomentImageFile } from "@/lib/moment-image-validation";

export type MomentRequestInput = {
  title: string;
  description: string;
  mood: MoodId;
  date: string;
};

export type MomentRequestErrors = Partial<
  Record<keyof MomentRequestInput | "image" | "request", string>
>;

export type MomentRequestValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: MomentRequestErrors };

const allowedFields = new Set<keyof MomentRequestInput>([
  "title",
  "description",
  "mood",
  "date",
]);

export type CreateMomentFormInput = {
  input: MomentRequestInput;
  image: File | null;
};

export type MomentImageMutation =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "replace"; image: File };

export type UpdateMomentFormInput = {
  input: Partial<MomentRequestInput>;
  imageMutation: MomentImageMutation;
};

const allowedMoods = new Set<MoodId>([
  "happy",
  "calm",
  "loved",
  "sad",
  "angry",
  "tired",
]);

function isRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnsupportedFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).some(
    (field) => !allowedFields.has(field as keyof MomentRequestInput),
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateFields(
  value: Record<string, unknown>,
  fields: readonly (keyof MomentRequestInput)[],
): MomentRequestValidationResult<Partial<MomentRequestInput>> {
  const errors: MomentRequestErrors = {};
  const data: Partial<MomentRequestInput> = {};

  if (fields.includes("title")) {
    const title = typeof value.title === "string" ? value.title.trim() : "";

    if (!title) {
      errors.title = "Give this moment a title.";
    } else if (title.length > 80) {
      errors.title = "Keep the title to 80 characters or fewer.";
    } else {
      data.title = title;
    }
  }

  if (fields.includes("description")) {
    const description =
      typeof value.description === "string" ? value.description.trim() : "";

    if (!description) {
      errors.description = "Describe the moment you want to remember.";
    } else if (description.length > 280) {
      errors.description = "Keep the description to 280 characters or fewer.";
    } else {
      data.description = description;
    }
  }

  if (fields.includes("mood")) {
    if (
      typeof value.mood !== "string" ||
      !allowedMoods.has(value.mood as MoodId)
    ) {
      errors.mood = "Choose a supported mood.";
    } else {
      data.mood = value.mood as MoodId;
    }
  }

  if (fields.includes("date")) {
    if (typeof value.date !== "string" || !isValidDate(value.date)) {
      errors.date = "Choose a valid date.";
    } else {
      data.date = value.date;
    }
  }

  return Object.keys(errors).length > 0
    ? { success: false, errors }
    : { success: true, data };
}

export function parseCreateMomentRequest(
  value: unknown,
): MomentRequestValidationResult<MomentRequestInput> {
  if (!isRequestObject(value)) {
    return {
      success: false,
      errors: { request: "Request body must be a JSON object." },
    };
  }

  if (hasUnsupportedFields(value)) {
    return {
      success: false,
      errors: { request: "Request body contains unsupported fields." },
    };
  }

  const result = validateFields(value, [
    "title",
    "description",
    "mood",
    "date",
  ]);

  return result.success
    ? { success: true, data: result.data as MomentRequestInput }
    : result;
}

export function parseUpdateMomentRequest(
  value: unknown,
): MomentRequestValidationResult<Partial<MomentRequestInput>> {
  if (!isRequestObject(value)) {
    return {
      success: false,
      errors: { request: "Request body must be a JSON object." },
    };
  }

  if (hasUnsupportedFields(value)) {
    return {
      success: false,
      errors: { request: "Request body contains unsupported fields." },
    };
  }

  const fields = Object.keys(value) as (keyof MomentRequestInput)[];

  if (fields.length === 0) {
    return {
      success: false,
      errors: { request: "Provide at least one Moment field to update." },
    };
  }

  return validateFields(value, fields);
}

function formDataObject(
  formData: FormData,
  allowed: ReadonlySet<string>,
): MomentRequestValidationResult<Record<string, FormDataEntryValue>> {
  const data: Record<string, FormDataEntryValue> = {};

  for (const [field, value] of formData.entries()) {
    if (!allowed.has(field) || Object.hasOwn(data, field)) {
      return {
        success: false,
        errors: {
          request: "Request body contains unsupported or duplicate fields.",
        },
      };
    }

    data[field] = value;
  }

  return { success: true, data };
}

const createFormFields = new Set([...allowedFields, "image"]);
const updateFormFields = new Set([
  ...allowedFields,
  "imageAction",
  "image",
]);

function isFileValue(value: FormDataEntryValue): value is File {
  return (
    typeof value !== "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
  );
}

export async function parseCreateMomentFormData(
  formData: FormData,
): Promise<MomentRequestValidationResult<CreateMomentFormInput>> {
  const formResult = formDataObject(formData, createFormFields);

  if (!formResult.success) {
    return formResult;
  }

  const { image, ...fields } = formResult.data;
  const inputResult = parseCreateMomentRequest(fields);

  if (!inputResult.success) {
    return inputResult;
  }

  if (image !== undefined && !isFileValue(image)) {
    return {
      success: false,
      errors: { image: "Choose a valid JPEG, PNG, or WebP image." },
    };
  }

  if (image && isFileValue(image)) {
    const imageResult = await validateMomentImageFile(image);

    if (!imageResult.success) {
      return { success: false, errors: { image: imageResult.error } };
    }
  }

  return {
    success: true,
    data: { input: inputResult.data, image: image ?? null },
  };
}

export async function parseUpdateMomentFormData(
  formData: FormData,
): Promise<MomentRequestValidationResult<UpdateMomentFormInput>> {
  const formResult = formDataObject(formData, updateFormFields);

  if (!formResult.success) {
    return formResult;
  }

  const { imageAction, image, ...fields } = formResult.data;

  if (
    imageAction !== undefined &&
    imageAction !== "replace" &&
    imageAction !== "remove" &&
    imageAction !== "keep"
  ) {
    return {
      success: false,
      errors: { request: "Choose a supported image action." },
    };
  }

  const normalizedAction = imageAction ?? (image ? "replace" : "keep");

  if (normalizedAction === "replace") {
    if (!image || !isFileValue(image)) {
      return {
        success: false,
        errors: { image: "Choose a valid JPEG, PNG, or WebP image." },
      };
    }

    const imageResult = await validateMomentImageFile(image);

    if (!imageResult.success) {
      return { success: false, errors: { image: imageResult.error } };
    }
  } else if (image !== undefined) {
    return {
      success: false,
      errors: { request: "The image does not match the requested action." },
    };
  }

  let input: Partial<MomentRequestInput> = {};
  if (Object.keys(fields).length > 0) {
    const inputResult = parseUpdateMomentRequest(fields);

    if (!inputResult.success) {
      return inputResult;
    }

    input = inputResult.data;
  } else if (normalizedAction === "keep") {
    return {
      success: false,
      errors: { request: "Provide at least one Moment field to update." },
    };
  }

  const imageMutation: MomentImageMutation =
    normalizedAction === "replace"
      ? { kind: "replace", image: image as File }
      : { kind: normalizedAction };

  return { success: true, data: { input, imageMutation } };
}
