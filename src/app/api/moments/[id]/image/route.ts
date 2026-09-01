import {
  createAuthenticatedMomentService,
  errorResponse,
  handleMomentApiError,
  isValidMomentId,
} from "@/lib/moment-api-server";

type MomentImageRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  context: MomentImageRouteContext,
) {
  try {
    const service = await createAuthenticatedMomentService("read");
    const { id } = await context.params;

    if (!isValidMomentId(id)) {
      return errorResponse(400, "INVALID_ID", "Moment id is invalid.");
    }

    const image = await service.download(id);

    return new Response(image.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": image.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleMomentApiError(error);
  }
}
