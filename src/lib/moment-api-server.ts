import {
  AuthenticatedMomentService,
  MomentImageLifecycleError,
} from "@/lib/authenticated-moment-service";
import {
  AuthenticatedMomentImportService,
  LegacyImportSourceConflictError,
  MomentImportLifecycleError,
} from "@/lib/authenticated-moment-import-service";
import { createAuthenticatedSupabaseClient, SupabaseAuthenticationError } from "@/lib/supabase/server";
import { SupabaseMomentImageRepository } from "@/repositories/supabase-moment-image-repository";
import {
  MomentNotFoundError,
  SupabaseMomentRepository,
} from "@/repositories/supabase-moment-repository";

type ApiErrorCode =
  | "INTERNAL_ERROR"
  | "INVALID_ID"
  | "INVALID_FORM_DATA"
  | "INVALID_JSON"
  | "IMPORT_SOURCE_CONFLICT"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export async function createAuthenticatedMomentRepository() {
  const { client } = await createAuthenticatedSupabaseClient();

  return new SupabaseMomentRepository(client);
}

export async function createAuthenticatedMomentService() {
  const { client, userId } = await createAuthenticatedSupabaseClient();

  return new AuthenticatedMomentService(
    new SupabaseMomentRepository(client),
    new SupabaseMomentImageRepository(client),
    userId,
  );
}

export async function createAuthenticatedMomentImportService() {
  const { client, userId } = await createAuthenticatedSupabaseClient();

  return new AuthenticatedMomentImportService(
    new SupabaseMomentRepository(client),
    new SupabaseMomentImageRepository(client),
    userId,
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
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
  );
}

export function handleMomentApiError(error: unknown): Response {
  if (error instanceof SupabaseAuthenticationError) {
    return errorResponse(401, "UNAUTHORIZED", "Authentication is required.");
  }

  if (error instanceof MomentNotFoundError) {
    return errorResponse(404, "NOT_FOUND", "Moment not found.");
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
