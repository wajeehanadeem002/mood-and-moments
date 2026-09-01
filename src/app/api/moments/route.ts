import { prepareMoment } from "@/lib/moment-creation";
import {
  createAuthenticatedMomentService,
  errorResponse,
  handleMomentApiError,
  isMultipartRequest,
  jsonResponse,
  readFormDataBody,
  readJsonBody,
} from "@/lib/moment-api-server";
import {
  parseCreateMomentFormData,
  parseCreateMomentRequest,
} from "@/lib/moment-request-validation";

export async function GET() {
  try {
    const service = await createAuthenticatedMomentService("read");
    const moments = await service.list();

    return jsonResponse({ moments });
  } catch (error) {
    return handleMomentApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const service = await createAuthenticatedMomentService("mutation");
    let input;
    let image: File | null = null;

    if (isMultipartRequest(request)) {
      const body = await readFormDataBody(request);

      if (!body.success) {
        return errorResponse(
          400,
          "INVALID_FORM_DATA",
          "Request body must be valid multipart form data.",
        );
      }

      const validation = await parseCreateMomentFormData(body.data);

      if (!validation.success) {
        return errorResponse(
          422,
          "VALIDATION_ERROR",
          "Moment details are invalid.",
          validation.errors,
        );
      }

      input = validation.data.input;
      image = validation.data.image;
    } else {
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

      input = validation.data;
    }

    const candidate = await prepareMoment({
      ...input,
      image: null,
    });
    const moment = await service.create(candidate, image);

    return jsonResponse({ moment }, 201);
  } catch (error) {
    return handleMomentApiError(error);
  }
}
