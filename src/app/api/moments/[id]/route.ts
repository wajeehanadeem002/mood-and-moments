import { updateMoment } from "@/lib/moment-creation";
import {
  createAuthenticatedMomentRepository,
  errorResponse,
  handleMomentApiError,
  isValidMomentId,
  jsonResponse,
  readJsonBody,
} from "@/lib/moment-api-server";
import { parseUpdateMomentRequest } from "@/lib/moment-request-validation";

type MomentRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: MomentRouteContext) {
  try {
    const repository = await createAuthenticatedMomentRepository();
    const { id } = await context.params;

    if (!isValidMomentId(id)) {
      return errorResponse(400, "INVALID_ID", "Moment id is invalid.");
    }

    const body = await readJsonBody(request);

    if (!body.success) {
      return errorResponse(
        400,
        "INVALID_JSON",
        "Request body must be valid JSON.",
      );
    }

    const validation = parseUpdateMomentRequest(body.data);

    if (!validation.success) {
      return errorResponse(
        422,
        "VALIDATION_ERROR",
        "Moment details are invalid.",
        validation.errors,
      );
    }

    const existingMoment = await repository.findById(id);

    if (!existingMoment) {
      return errorResponse(404, "NOT_FOUND", "Moment not found.");
    }

    const moment = await updateMoment(repository, existingMoment, {
      title: validation.data.title ?? existingMoment.title,
      description: validation.data.description ?? existingMoment.excerpt,
      mood: validation.data.mood ?? existingMoment.mood,
      date: validation.data.date ?? existingMoment.dateTime.slice(0, 10),
      image: null,
    });

    return jsonResponse({ moment });
  } catch (error) {
    return handleMomentApiError(error);
  }
}

export async function DELETE(_request: Request, context: MomentRouteContext) {
  try {
    const repository = await createAuthenticatedMomentRepository();
    const { id } = await context.params;

    if (!isValidMomentId(id)) {
      return errorResponse(400, "INVALID_ID", "Moment id is invalid.");
    }

    await repository.delete(id);

    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleMomentApiError(error);
  }
}
