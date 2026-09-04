import { createAccountDataExport } from "@/lib/account-data-export";
import { requireStrictAccountReverification } from "@/lib/account-export-server";
import {
  handleMomentApiError,
} from "@/lib/moment-api-server";
import { enforceMomentApiRateLimit } from "@/lib/moment-api-rate-limit";
import { createAuthenticatedSupabaseClient } from "@/lib/supabase/server";
import { SupabaseAccountExportRepository } from "@/repositories/supabase-account-export-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
};

export async function POST(): Promise<Response> {
  try {
    const reverificationResponse =
      await requireStrictAccountReverification();
    if (reverificationResponse) return reverificationResponse;

    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    return handleMomentApiError(error);
  }
}

export async function GET(): Promise<Response> {
  try {
    const reverificationResponse =
      await requireStrictAccountReverification();
    if (reverificationResponse) return reverificationResponse;

    const { client } = await createAuthenticatedSupabaseClient();
    await enforceMomentApiRateLimit(client, "export");
    const archive = await createAccountDataExport(
      new SupabaseAccountExportRepository(client),
    );

    return new Response(archive.stream, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Disposition": `attachment; filename="${archive.fileName}"`,
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleMomentApiError(error);
  }
}
