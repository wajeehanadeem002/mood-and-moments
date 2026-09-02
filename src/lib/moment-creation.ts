import type { Moment, MoodId } from "@/data/moments";
import type { MomentRepository } from "@/repositories/moment-repository";

export type MomentDraft = {
  title: string;
  description: string;
  mood: MoodId;
  date: string;
  image: File | null;
};

export type MomentFieldErrors = Partial<
  Record<"title" | "description" | "date" | "image", string>
>;

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const maximumImageSize = 1_000_000;

export function validateMomentImage(image: File): string | null {
  if (!supportedImageTypes.has(image.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }

  if (image.size > maximumImageSize) {
    return "Choose an image that is 1 MB or smaller.";
  }

  return null;
}

export function validateMomentDraft(
  draft: MomentDraft,
): MomentFieldErrors {
  const errors: MomentFieldErrors = {};

  if (!draft.title.trim()) {
    errors.title = "Give this moment a title.";
  } else if (draft.title.trim().length > 80) {
    errors.title = "Keep the title to 80 characters or fewer.";
  }

  if (!draft.description.trim()) {
    errors.description = "Describe the moment you want to remember.";
  } else if (draft.description.trim().length > 280) {
    errors.description =
      "Keep the description to 280 characters or fewer.";
  }

  if (!draft.date) {
    errors.date = "Choose the date of this moment.";
  }

  if (draft.image) {
    const imageError = validateMomentImage(draft.image);

    if (imageError) {
      errors.image = imageError;
    }
  }

  return errors;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () =>
      reject(new Error("The selected image could not be read.")),
    );
    reader.readAsDataURL(file);
  });
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function padTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

type CreateMomentOptions = {
  id?: string;
  now?: Date;
};

export type UpdateMomentOptions = {
  removeImage?: boolean;
};

export async function createMoment(
  repository: MomentRepository,
  draft: MomentDraft,
  options: CreateMomentOptions = {},
): Promise<Moment> {
  return repository.create(await prepareMoment(draft, options));
}

export async function prepareMoment(
  draft: MomentDraft,
  options: CreateMomentOptions = {},
): Promise<Moment> {
  if (Object.keys(validateMomentDraft(draft)).length > 0) {
    throw new Error("Moment draft is invalid.");
  }

  const now = options.now ?? new Date();
  const title = draft.title.trim();
  const imageSource = draft.image ? await fileToDataUrl(draft.image) : null;
  const moment: Moment = {
    id: options.id ?? crypto.randomUUID(),
    date: formatDate(draft.date),
    dateTime: `${draft.date}T${padTimePart(now.getHours())}:${padTimePart(
      now.getMinutes(),
    )}:${padTimePart(now.getSeconds())}`,
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(now),
    mood: draft.mood,
    title,
    excerpt: draft.description.trim(),
    ...(imageSource
      ? {
          image: {
            src: imageSource,
            alt: `${title} moment image.`,
          },
        }
      : {}),
  };

  return moment;
}

export async function updateMoment(
  repository: MomentRepository,
  existingMoment: Moment,
  draft: MomentDraft,
  options: UpdateMomentOptions = {},
): Promise<Moment> {
  return repository.update(
    await prepareUpdatedMoment(existingMoment, draft, options),
  );
}

export async function prepareUpdatedMoment(
  existingMoment: Moment,
  draft: MomentDraft,
  options: UpdateMomentOptions = {},
): Promise<Moment> {
  if (Object.keys(validateMomentDraft(draft)).length > 0) {
    throw new Error("Moment draft is invalid.");
  }

  const title = draft.title.trim();
  const replacementImageSource = draft.image
    ? await fileToDataUrl(draft.image)
    : null;
  const imageSource =
    replacementImageSource ??
    (options.removeImage ? undefined : existingMoment.image?.src);
  const moment: Moment = {
    id: existingMoment.id,
    ...(existingMoment.revision
      ? { revision: existingMoment.revision }
      : {}),
    date: formatDate(draft.date),
    dateTime: `${draft.date}${existingMoment.dateTime.slice(10)}`,
    time: existingMoment.time,
    mood: draft.mood,
    title,
    excerpt: draft.description.trim(),
    ...(imageSource
      ? {
          image: {
            src: imageSource,
            alt: `${title} moment image.`,
          },
        }
      : {}),
  };

  return moment;
}
