import type { MoodId } from "@/data/moments";

export type MomentRequestInput = {
  title: string;
  description: string;
  mood: MoodId;
  date: string;
};

export type MomentRequestErrors = Partial<
  Record<keyof MomentRequestInput | "request", string>
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
