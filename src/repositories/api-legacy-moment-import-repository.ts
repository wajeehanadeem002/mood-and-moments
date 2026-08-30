import type { Moment } from "@/data/moments";
import type { LegacyImportCandidate } from "@/lib/legacy-moment-import";

export type LegacyMomentImportApiResult = {
  outcome:
    | "created"
    | "already_imported"
    | "completed_existing"
    | "image_mismatch";
  imageOutcome:
    | "uploaded"
    | "already_present"
    | "not_provided"
    | "mismatch";
  sourceId: string;
  sourceHash: string;
  moment: Moment;
};

type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

const allowedMoods = new Set<Moment["mood"]>([
  "happy",
  "calm",
  "loved",
  "sad",
  "angry",
  "tired",
]);

export class ApiLegacyMomentImportRepositoryError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiLegacyMomentImportRepositoryError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMoment(value: unknown): value is Moment {
  if (!value || typeof value !== "object") return false;
  const moment = value as Record<string, unknown>;
  const image = moment.image;
  const validImage =
    image === undefined ||
    (typeof image === "object" &&
      image !== null &&
      isNonEmptyString((image as Record<string, unknown>).src) &&
      isNonEmptyString((image as Record<string, unknown>).alt));

  return (
    isNonEmptyString(moment.id) &&
    isNonEmptyString(moment.date) &&
    isNonEmptyString(moment.dateTime) &&
    isNonEmptyString(moment.time) &&
    typeof moment.mood === "string" &&
    allowedMoods.has(moment.mood as Moment["mood"]) &&
    isNonEmptyString(moment.title) &&
    isNonEmptyString(moment.excerpt) &&
    validImage
  );
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== "object") return false;
  const error = (value as Record<string, unknown>).error;
  return (
    typeof error === "object" &&
    error !== null &&
    isNonEmptyString((error as Record<string, unknown>).code) &&
    isNonEmptyString((error as Record<string, unknown>).message)
  );
}

function isResult(value: unknown): value is LegacyMomentImportApiResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const hasConsistentImageOutcome =
    (result.outcome === "image_mismatch" &&
      result.imageOutcome === "mismatch") ||
    (result.outcome !== "image_mismatch" &&
      result.imageOutcome !== "mismatch");

  return (
    (result.outcome === "created" ||
      result.outcome === "already_imported" ||
      result.outcome === "completed_existing" ||
      result.outcome === "image_mismatch") &&
    (result.imageOutcome === "uploaded" ||
      result.imageOutcome === "already_present" ||
      result.imageOutcome === "not_provided" ||
      result.imageOutcome === "mismatch") &&
    hasConsistentImageOutcome &&
    isNonEmptyString(result.sourceId) &&
    /^[a-f0-9]{64}$/.test(String(result.sourceHash)) &&
    isMoment(result.moment)
  );
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class ApiLegacyMomentImportRepository {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async import(
    candidate: LegacyImportCandidate,
    signal?: AbortSignal,
  ): Promise<LegacyMomentImportApiResult> {
    const formData = new FormData();
    formData.set("sourceId", candidate.sourceId);
    formData.set("title", candidate.title);
    formData.set("description", candidate.description);
    formData.set("mood", candidate.mood);
    formData.set("date", candidate.date);
    formData.set("time", candidate.time);
    if (candidate.image) formData.set("image", candidate.image);

    let response: Response;
    try {
      response = await this.fetcher("/api/moments/import", {
        body: formData,
        headers: { Accept: "application/json" },
        method: "POST",
        signal,
      });
    } catch (cause) {
      throw new ApiLegacyMomentImportRepositoryError(
        "The legacy Moment import service is temporarily unavailable.",
        undefined,
        "NETWORK_ERROR",
        undefined,
        { cause },
      );
    }

    const body = await json(response);
    if (!response.ok) {
      if (isErrorBody(body)) {
        throw new ApiLegacyMomentImportRepositoryError(
          body.error.message,
          response.status,
          body.error.code,
          body.error.fields,
        );
      }
      throw new ApiLegacyMomentImportRepositoryError(
        "The legacy Moment import service is temporarily unavailable.",
        response.status,
        "INVALID_ERROR_RESPONSE",
      );
    }

    const result =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).result
        : undefined;
    if (
      !isResult(result) ||
      result.sourceId !== candidate.sourceId ||
      result.sourceHash !== candidate.sourceHash
    ) {
      throw new ApiLegacyMomentImportRepositoryError(
        "The legacy Moment import service returned an invalid response.",
        response.status,
        "INVALID_RESPONSE",
      );
    }

    return result;
  }
}
