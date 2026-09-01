import { prepareMoment } from "@/lib/moment-creation";
import {
  canonicalLegacyMomentValue,
  sha256Text,
} from "@/lib/legacy-moment-import";
import { parseLegacyMomentImportFormData } from "@/lib/legacy-moment-import-request";
import {
  createAuthenticatedMomentImportService,
  errorResponse,
  handleMomentApiError,
  isMultipartRequest,
  jsonResponse,
  readFormDataBody,
} from "@/lib/moment-api-server";

export async function POST(request: Request) {
  try {
    const service = await createAuthenticatedMomentImportService("import");

    if (!isMultipartRequest(request)) {
      return errorResponse(
        400,
        "INVALID_FORM_DATA",
        "Request body must be valid multipart form data.",
      );
    }

    const body = await readFormDataBody(request);
    if (!body.success) {
      return errorResponse(
        400,
        "INVALID_FORM_DATA",
        "Request body must be valid multipart form data.",
      );
    }

    const validation = await parseLegacyMomentImportFormData(body.data);
    if (!validation.success) {
      return errorResponse(
        422,
        "VALIDATION_ERROR",
        "Legacy Moment details are invalid.",
        validation.errors,
      );
    }

    const { image, input, sourceId, time } = validation.data;
    const normalized = {
      sourceId,
      title: input.title,
      description: input.description,
      mood: input.mood,
      date: input.date,
      time,
    };
    const sourceHash = await sha256Text(canonicalLegacyMomentValue(normalized));
    const candidate = await prepareMoment({ ...input, image: null });
    const result = await service.import(
      candidate,
      { sourceId, sourceHash, time },
      image,
    );

    return jsonResponse({ result }, result.outcome === "created" ? 201 : 200);
  } catch (error) {
    return handleMomentApiError(error);
  }
}
