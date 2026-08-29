import { createMoment } from "@/lib/moment-creation";
import {
  createAuthenticatedMomentRepository,
  errorResponse,
  handleMomentApiError,
  jsonResponse,
  readJsonBody,
} from "@/lib/moment-api-server";
import { parseCreateMomentRequest } from "@/lib/moment-request-validation";

export async function GET() {
  try {
    const repository = await createAuthenticatedMomentRepository();
    const moments = await repository.list();

    return jsonResponse({ moments });
  } catch (error) {
    return handleMomentApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const repository = await createAuthenticatedMomentRepository();
    const body = await readJsonBody(request);

    if (!body.success) {
      return errorResponse(
        400,
        "INVALID_JSON",
        "Request body must be valid JSON.",
      );
    }

    const validation = parseCreateMomentRequest(body.data);

    if (!validation.success) {
      return errorResponse(
        422,
        "VALIDATION_ERROR",
        "Moment details are invalid.",
        validation.errors,
      );
    }

    const moment = await createMoment(repository, {
      ...validation.data,
      image: null,
    });

    return jsonResponse({ moment }, 201);
  } catch (error) {
    return handleMomentApiError(error);
  }
}
