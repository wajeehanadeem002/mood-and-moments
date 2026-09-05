import {
  AuthenticatedMomentService,
  MomentImageLifecycleError,
} from "@/lib/authenticated-moment-service";
import {
  AuthenticatedMomentImportService,
  LegacyImportSourceConflictError,
  MomentImportLifecycleError,
} from "@/lib/authenticated-moment-import-service";
import {
  enforceMomentApiRateLimit,
  type MomentApiRateLimitBucket,
  MomentApiRateLimitExceededError,
  MomentApiRateLimitUnavailableError,
} from "@/lib/moment-api-rate-limit";
import { createAuthenticatedSupabaseClient, SupabaseAuthenticationError } from "@/lib/supabase/server";
import { SupabaseMomentImageRepository } from "@/repositories/supabase-moment-image-repository";
import {
  MomentNotFoundError,
  MomentVersionConflictError,
  SupabaseMomentRepository,
} from "@/repositories/supabase-moment-repository";
import { MomentConflictError } from "@/repositories/moment-repository";

type ApiErrorCode =
  | "ACCOUNT_DATA_DELETION_INCOMPLETE"
  | "INTERNAL_ERROR"
  | "INVALID_ID"
  | "INVALID_FORM_DATA"
  | "INVALID_CONFIRMATION"
  | "INVALID_JSON"
  | "INVALID_PRECONDITION"
  | "IMPORT_SOURCE_CONFLICT"
  | "MOMENT_VERSION_CONFLICT"
  | "NOT_FOUND"
  | "PRECONDITION_REQUIRED"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export async function createAuthenticatedMomentRepository() {
  const { client } = await createAuthenticatedSupabaseClient();

  return new SupabaseMomentRepository(client);
}

export async function createAuthenticatedMomentService(
  bucket: MomentApiRateLimitBucket,
) {
  const { client, userId } = await createAuthenticatedSupabaseClient();
  await enforceMomentApiRateLimit(client, bucket);

  return new AuthenticatedMomentService(
    new SupabaseMomentRepository(client),
    new SupabaseMomentImageRepository(client),
    userId,
  );
}

export async function createAuthenticatedMomentImportService(
  bucket: MomentApiRateLimitBucket,
) {
  const { client, userId } = await createAuthenticatedSupabaseClient();
  await enforceMomentApiRateLimit(client, bucket);

  return new AuthenticatedMomentImportService(
    new SupabaseMomentRepository(client),
    new SupabaseMomentImageRepository(client),
    userId,
  );
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
  headers?: HeadersInit,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
      },
    },
    status,
    headers,
  );
}

export function momentVersionConflictResponse(
  error: MomentConflictError,
): Response {
  return jsonResponse(
    {
      error: {
        code: "MOMENT_VERSION_CONFLICT",
        message: "This Moment changed after you loaded it.",
        currentMoment: error.currentMoment,
      },
    },
    412,
  );
}

export function handleMomentApiError(error: unknown): Response {
  if (error instanceof SupabaseAuthenticationError) {
    return errorResponse(401, "UNAUTHORIZED", "Authentication is required.");
  }

  if (error instanceof MomentApiRateLimitExceededError) {
    const retryAfter = error.retryAfterSeconds.toString();

    return errorResponse(
      429,
      "RATE_LIMITED",
      "Too many requests. Please try again shortly.",
      undefined,
      {
        "RateLimit-Limit": error.limit.toString(),
        "RateLimit-Remaining": error.remaining.toString(),
        "RateLimit-Reset": retryAfter,
        "Retry-After": retryAfter,
      },
    );
  }

  if (error instanceof MomentApiRateLimitUnavailableError) {
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "The Moment service is temporarily unavailable.",
    );
  }

  if (error instanceof MomentNotFoundError) {
    return errorResponse(404, "NOT_FOUND", "Moment not found.");
  }

  if (
    error instanceof MomentVersionConflictError &&
    error.cleanupFailures.length > 0
  ) {
    console.error(
      "Moment image compensation cleanup did not complete.",
      error,
    );
  }

  if (error instanceof MomentConflictError) {
    return momentVersionConflictResponse(error);
  }

  if (error instanceof LegacyImportSourceConflictError) {
    return errorResponse(
      409,
      "IMPORT_SOURCE_CONFLICT",
      "This legacy Moment changed after it was imported.",
    );
  }

  if (
    (error instanceof MomentImageLifecycleError ||
      error instanceof MomentImportLifecycleError) &&
    error.cleanupFailures.length > 0
  ) {
    console.error(
      "Moment image compensation cleanup did not complete.",
      error,
    );
  }

  return errorResponse(
    500,
    "INTERNAL_ERROR",
    "The Moment service is temporarily unavailable.",
  );
}

export function isValidMomentId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

export function readMomentRevisionPrecondition(
  request: Request,
): { success: true; revision: number } | { success: false; response: Response } {
  const value = request.headers.get("x-moment-revision");

  if (value === null) {
    return {
      success: false,
      response: errorResponse(
        428,
        "PRECONDITION_REQUIRED",
        "A current Moment revision is required.",
      ),
    };
  }

  const match = /^([1-9][0-9]*)$/.exec(value);
  const revision = match ? Number(match[1]) : Number.NaN;

  if (!Number.isSafeInteger(revision)) {
    return {
      success: false,
      response: errorResponse(
        400,
        "INVALID_PRECONDITION",
        "X-Moment-Revision must contain one current Moment revision.",
      ),
    };
  }

  return { success: true, revision };
}

export async function readJsonBody(
  request: Request,
): Promise<{ success: true; data: unknown } | { success: false }> {
  try {
    return { success: true, data: await request.json() };
  } catch {
    return { success: false };
  }
}

export function isMultipartRequest(request: Request): boolean {
  return request.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith("multipart/form-data") ?? false;
}

export async function readFormDataBody(
  request: Request,
): Promise<{ success: true; data: FormData } | { success: false }> {
  try {
    return { success: true, data: await request.formData() };
  } catch {
    return { success: false };
  }
}
