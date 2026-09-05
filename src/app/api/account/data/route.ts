import {
  AccountDataDeletionIncompleteError,
  deleteAccountData,
} from "@/lib/account-data-deletion";
import { requireStrictAccountReverification } from "@/lib/account-export-server";
import { errorResponse, handleMomentApiError } from "@/lib/moment-api-server";
import { enforceMomentApiRateLimit } from "@/lib/moment-api-rate-limit";
import { createAuthenticatedSupabaseClient } from "@/lib/supabase/server";
import { SupabaseAccountDataDeletionRepository } from "@/repositories/supabase-account-data-deletion-repository";
import { SupabaseMomentImageRepository } from "@/repositories/supabase-moment-image-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
};
const confirmationPhrase = "DELETE MY DATA";

async function hasValidConfirmation(request: Request): Promise<boolean> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const values = body as Record<string, unknown>;
    return (
      Object.keys(values).length === 1 &&
      values.confirmation === confirmationPhrase
    );
  } catch {
    return false;
  }
}

export async function POST(): Promise<Response> {
  try {
    const reverificationResponse = await requireStrictAccountReverification();
    if (reverificationResponse) return reverificationResponse;

    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    return handleMomentApiError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    const reverificationResponse = await requireStrictAccountReverification();
    if (reverificationResponse) return reverificationResponse;

    if (!(await hasValidConfirmation(request))) {
      return errorResponse(
        400,
        "INVALID_CONFIRMATION",
        "The account data deletion confirmation is invalid.",
      );
    }

    const { client, userId } = await createAuthenticatedSupabaseClient();
    await enforceMomentApiRateLimit(client, "delete-data");
    const result = await deleteAccountData(
      new SupabaseAccountDataDeletionRepository(client, userId),
      new SupabaseMomentImageRepository(client),
    );

    console.info("Account cloud data deletion verified.", {
      correlationId,
      deletedImages: result.deletedImages,
      deletedMoments: result.deletedMoments,
      stage: "complete",
    });

    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    if (error instanceof AccountDataDeletionIncompleteError) {
      console.warn("Account cloud data deletion remains incomplete.", {
        correlationId,
        remainingCleanupAuthorizations:
          error.remainingCleanupAuthorizations,
        remainingMoments: error.remainingMoments,
        remainingStorageObjects: error.remainingStorageObjects,
        remainingDeletionJobs: error.remainingDeletionJobs,
        stage: "cleanup_pending",
      });
      return errorResponse(
        503,
        "ACCOUNT_DATA_DELETION_INCOMPLETE",
        "Your cloud data deletion is incomplete. Please try again.",
      );
    }

    return handleMomentApiError(error);
  }
}
