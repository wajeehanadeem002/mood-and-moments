import type { Moment } from "@/data/moments";
import type { MomentRepository } from "@/repositories/moment-repository";

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

export class ApiMomentRepositoryError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiMomentRepositoryError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMoment(value: unknown): value is Moment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const image = candidate.image;
  const hasValidImage =
    image === undefined ||
    (typeof image === "object" &&
      image !== null &&
      isNonEmptyString((image as Record<string, unknown>).src) &&
      isNonEmptyString((image as Record<string, unknown>).alt));

  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.date) &&
    isNonEmptyString(candidate.dateTime) &&
    isNonEmptyString(candidate.time) &&
    typeof candidate.mood === "string" &&
    allowedMoods.has(candidate.mood as Moment["mood"]) &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.excerpt) &&
    hasValidImage
  );
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const error = (value as Record<string, unknown>).error;

  return (
    typeof error === "object" &&
    error !== null &&
    isNonEmptyString((error as Record<string, unknown>).code) &&
    isNonEmptyString((error as Record<string, unknown>).message)
  );
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function requestBody(moment: Moment) {
  return {
    title: moment.title,
    description: moment.excerpt,
    mood: moment.mood,
    date: moment.dateTime.slice(0, 10),
  };
}

function imageFileFromDataUrl(source: string): File {
  const match = source.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/,
  );

  if (!match) {
    throw new ApiMomentRepositoryError(
      "Moment image source is not trusted.",
      undefined,
      "INVALID_IMAGE_SOURCE",
    );
  }

  try {
    const type = match[1]!;
    const binary = atob(match[2]!);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );

    return new File([bytes], "moment-image", { type });
  } catch (cause) {
    throw new ApiMomentRepositoryError(
      "Moment image source is not trusted.",
      undefined,
      "INVALID_IMAGE_SOURCE",
      undefined,
      { cause },
    );
  }
}

function multipartBody(moment: Moment, imageAction?: "remove" | "replace") {
  const formData = new FormData();
  const fields = requestBody(moment);

  formData.set("title", fields.title);
  formData.set("description", fields.description);
  formData.set("mood", fields.mood);
  formData.set("date", fields.date);

  if (imageAction) {
    formData.set("imageAction", imageAction);
  }

  if (moment.image?.src.startsWith("data:")) {
    formData.set("image", imageFileFromDataUrl(moment.image.src));
  }

  return formData;
}

function isPrivateImageProxy(moment: Moment) {
  return (
    moment.image?.src ===
    `/api/moments/${encodeURIComponent(moment.id)}/image`
  );
}

export class ApiMomentRepository implements MomentRepository {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request(
    input: string,
    init: RequestInit,
  ): Promise<Response> {
    let response: Response;

    try {
      const fetcher = this.fetcher;
      response = await fetcher(input, init);
    } catch (cause) {
      throw new ApiMomentRepositoryError(
        "The Moment service is temporarily unavailable.",
        undefined,
        "NETWORK_ERROR",
        undefined,
        { cause },
      );
    }

    if (response.ok) {
      return response;
    }

    const body = await readResponseJson(response);

    if (isApiErrorBody(body)) {
      throw new ApiMomentRepositoryError(
        body.error.message,
        response.status,
        body.error.code,
        body.error.fields,
      );
    }

    throw new ApiMomentRepositoryError(
      "The Moment service is temporarily unavailable.",
      response.status,
      "INVALID_ERROR_RESPONSE",
    );
  }

  async list(): Promise<Moment[]> {
    const response = await this.request("/api/moments", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
    });
    const body = await readResponseJson(response);
    const moments =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).moments
        : undefined;

    if (!Array.isArray(moments) || !moments.every(isMoment)) {
      throw new ApiMomentRepositoryError(
        "Moment service returned an invalid response.",
        response.status,
        "INVALID_RESPONSE",
      );
    }

    return moments;
  }

  async create(moment: Moment): Promise<Moment> {
    if (!moment.image) {
      return this.writeJsonMoment("/api/moments", "POST", moment);
    }

    if (!moment.image.src.startsWith("data:")) {
      throw new ApiMomentRepositoryError(
        "Moment image source is not trusted.",
        undefined,
        "INVALID_IMAGE_SOURCE",
      );
    }

    return this.writeMultipartMoment(
      "/api/moments",
      "POST",
      multipartBody(moment),
    );
  }

  async update(moment: Moment): Promise<Moment> {
    const endpoint = `/api/moments/${encodeURIComponent(moment.id)}`;

    if (!moment.image) {
      return this.writeMultipartMoment(
        endpoint,
        "PATCH",
        multipartBody(moment, "remove"),
      );
    }

    if (moment.image.src.startsWith("data:")) {
      return this.writeMultipartMoment(
        endpoint,
        "PATCH",
        multipartBody(moment, "replace"),
      );
    }

    if (isPrivateImageProxy(moment)) {
      return this.writeJsonMoment(endpoint, "PATCH", moment);
    }

    throw new ApiMomentRepositoryError(
      "Moment image source is not trusted.",
      undefined,
      "INVALID_IMAGE_SOURCE",
    );
  }

  async delete(id: string): Promise<void> {
    await this.request(`/api/moments/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      method: "DELETE",
    });
  }

  private async writeJsonMoment(
    input: string,
    method: "PATCH" | "POST",
    moment: Moment,
  ): Promise<Moment> {
    const response = await this.request(input, {
      body: JSON.stringify(requestBody(moment)),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method,
    });
    const body = await readResponseJson(response);
    const savedMoment =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).moment
        : undefined;

    if (!isMoment(savedMoment)) {
      throw new ApiMomentRepositoryError(
        "Moment service returned an invalid response.",
        response.status,
        "INVALID_RESPONSE",
      );
    }

    return savedMoment;
  }

  private async writeMultipartMoment(
    input: string,
    method: "PATCH" | "POST",
    body: FormData,
  ): Promise<Moment> {
    const response = await this.request(input, {
      body,
      headers: { Accept: "application/json" },
      method,
    });
    const responseBody = await readResponseJson(response);
    const savedMoment =
      responseBody && typeof responseBody === "object"
        ? (responseBody as Record<string, unknown>).moment
        : undefined;

    if (!isMoment(savedMoment)) {
      throw new ApiMomentRepositoryError(
        "Moment service returned an invalid response.",
        response.status,
        "INVALID_RESPONSE",
      );
    }

    return savedMoment;
  }
}
