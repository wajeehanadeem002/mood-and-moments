import type { Moment } from "@/data/moments";
import type { MomentRepository } from "@/repositories/moment-repository";

export const MOMENTS_STORAGE_KEY = "mood-and-moments.moments.v1";

const moodIds = new Set([
  "happy",
  "calm",
  "loved",
  "sad",
  "angry",
  "tired",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeImageSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]*$/i.test(value)
  );
}

function isStoredMoment(value: unknown): value is Moment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const moment = value as Record<string, unknown>;
  const image = moment.image;
  const hasValidImage =
    image === undefined ||
    (typeof image === "object" &&
      image !== null &&
      isSafeImageSource((image as Record<string, unknown>).src) &&
      isNonEmptyString((image as Record<string, unknown>).alt));

  return (
    isNonEmptyString(moment.id) &&
    isNonEmptyString(moment.date) &&
    isNonEmptyString(moment.dateTime) &&
    isNonEmptyString(moment.time) &&
    typeof moment.mood === "string" &&
    moodIds.has(moment.mood) &&
    isNonEmptyString(moment.title) &&
    isNonEmptyString(moment.excerpt) &&
    hasValidImage
  );
}

export class LocalStorageMomentRepository implements MomentRepository {
  constructor(private readonly storage: Storage) {}

  private readStoredMoments(): Moment[] {
    const storedValue = this.storage.getItem(MOMENTS_STORAGE_KEY);

    if (!storedValue) {
      return [];
    }

    try {
      const parsedValue: unknown = JSON.parse(storedValue);

      if (!Array.isArray(parsedValue) || !parsedValue.every(isStoredMoment)) {
        throw new Error("Stored Moments do not match the expected schema.");
      }

      return parsedValue;
    } catch {
      try {
        this.storage.removeItem(MOMENTS_STORAGE_KEY);
      } catch {
        // A blocked storage provider should not turn corrupt data into a crash.
      }

      return [];
    }
  }

  async list(): Promise<Moment[]> {
    return this.readStoredMoments();
  }

  async create(moment: Moment): Promise<Moment> {
    const storedMoments = this.readStoredMoments();
    this.storage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify([moment, ...storedMoments]),
    );

    return moment;
  }
}
