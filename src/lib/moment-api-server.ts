import { createAuthenticatedSupabaseClient, SupabaseAuthenticationError } from "@/lib/supabase/server";
import {
  MomentNotFoundError,
  SupabaseMomentRepository,
} from "@/repositories/supabase-moment-repository";

type ApiErrorCode =
  | "INTERNAL_ERROR"
  | "INVALID_ID"
  | "INVALID_JSON"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export async function createAuthenticatedMomentRepository() {
  const { client } = await createAuthenticatedSupabaseClient();

  return new SupabaseMomentRepository(client);
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
