import {
  auth,
  reverificationErrorResponse,
} from "@clerk/nextjs/server";

import { errorResponse } from "@/lib/moment-api-server";

function withPrivateNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function requireStrictAccountReverification(): Promise<Response | null> {
  const session = await auth();

  if (!session.isAuthenticated || !session.userId) {
    return errorResponse(401, "UNAUTHORIZED", "Authentication is required.");
  }

  if (!session.has({ reverification: "strict" })) {
    return withPrivateNoStore(reverificationErrorResponse("strict"));
  }

  return null;
}
