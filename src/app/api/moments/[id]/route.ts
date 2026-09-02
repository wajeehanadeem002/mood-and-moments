import { prepareUpdatedMoment } from "@/lib/moment-creation";
import {
  createAuthenticatedMomentService,
  errorResponse,
  handleMomentApiError,
  isMultipartRequest,
  isValidMomentId,
  jsonResponse,
  readMomentRevisionPrecondition,
  readFormDataBody,
  readJsonBody,
} from "@/lib/moment-api-server";
import {
  type MomentImageMutation,
  parseUpdateMomentFormData,
  parseUpdateMomentRequest,
} from "@/lib/moment-request-validation";

type MomentRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: MomentRouteContext) {
  try {
    const service = await createAuthenticatedMomentService("mutation");
    const { id } = await context.params;

    if (!isValidMomentId(id)) {
      return errorResponse(400, "INVALID_ID", "Moment id is invalid.");
    }

    const precondition = readMomentRevisionPrecondition(request);
    if (!precondition.success) {
      return precondition.response;
    }

    let input;
    let imageMutation: MomentImageMutation = { kind: "keep" };

    if (isMultipartRequest(request)) {
      const body = await readFormDataBody(request);

      if (!body.success) {
        return errorResponse(
          400,
          "INVALID_FORM_DATA",
          "Request body must be valid multipart form data.",
        );
      }

      const validation = await parseUpdateMomentFormData(body.data);

      if (!validation.success) {
        return errorResponse(
          422,
          "VALIDATION_ERROR",
          "Moment details are invalid.",
          validation.errors,
        );
      }

      input = validation.data.input;
      imageMutation = validation.data.imageMutation;
    } else {
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

      input = validation.data;
    }

    const record = await service.findRecordById(id);

    if (!record) {
      return errorResponse(404, "NOT_FOUND", "Moment not found.");
    }

    const candidate = await prepareUpdatedMoment(record.moment, {
      title: input.title ?? record.moment.title,
      description: input.description ?? record.moment.excerpt,
      mood: input.mood ?? record.moment.mood,
      date: input.date ?? record.moment.dateTime.slice(0, 10),
      image: null,
    }, {
      removeImage: imageMutation.kind === "remove",
    });
    const moment = await service.updateRecord(
      record,
      { ...candidate, revision: precondition.revision },
      imageMutation,
    );

    return jsonResponse({ moment });
  } catch (error) {
    return handleMomentApiError(error);
  }
}

export async function DELETE(request: Request, context: MomentRouteContext) {
  try {
    const service = await createAuthenticatedMomentService("mutation");
    const { id } = await context.params;

    if (!isValidMomentId(id)) {
      return errorResponse(400, "INVALID_ID", "Moment id is invalid.");
    }

    const precondition = readMomentRevisionPrecondition(request);
    if (!precondition.success) {
      return precondition.response;
    }

    await service.delete(id, precondition.revision);

    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleMomentApiError(error);
  }
}
