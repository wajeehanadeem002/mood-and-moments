import { randomUUID } from "node:crypto";

const CLERK_API_URL = "https://api.clerk.com/v1";
const TEST_IMAGE = new Blob(
  [
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4yQAAAAASUVORK5CYII=",
      "base64",
    ),
  ],
  { type: "image/png" },
);

function requireEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for hosted import verification.`);
  return value;
}

async function clerkRequest(secretKey, path, options = {}) {
  const response = await fetch(`${CLERK_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.errors?.[0]?.long_message ??
        body?.errors?.[0]?.message ??
        `Clerk API request failed with status ${response.status}.`,
    );
  }
  return response.status === 204 ? null : response.json();
}

async function createIdentity(secretKey, label, runId) {
  const user = await clerkRequest(secretKey, "/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [`mood-import-${label}-${runId}@example.com`],
      external_id: `mood-import-${label}-${runId}`,
      first_name: "Import",
      last_name: `Test ${label}`,
      password: `Mm!${randomUUID()}9z`,
    }),
  });
  const session = await clerkRequest(secretKey, "/sessions", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id }),
  });
  const token = await clerkRequest(secretKey, `/sessions/${session.id}/tokens`, {
    method: "POST",
    body: JSON.stringify({ expires_in_seconds: 180 }),
  });
  return { sessionId: session.id, token: token.jwt, userId: user.id };
}

async function cleanupStaleTestIdentities(secretKey) {
  const users = await clerkRequest(
    secretKey,
    "/users?limit=100&order_by=-created_at",
  );
  const stale = users.filter((user) =>
    /^mood-import-(?:owner|other)-[0-9a-f-]{36}$/.test(user.external_id ?? ""),
  );
  for (const user of stale) {
    await clerkRequest(secretKey, `/users/${user.id}`, { method: "DELETE" });
  }
}

function importBody(sourceId, overrides = {}) {
  const form = new FormData();
  form.set("sourceId", sourceId);
  form.set("title", overrides.title ?? "Hosted import memory");
  form.set("description", "Verified through Clerk and the Next.js import route.");
  form.set("mood", "calm");
  form.set("date", "2026-08-20");
  form.set("time", "17:42:19");
  if (overrides.image) {
    form.set("image", overrides.image, "hosted-import.png");
  }
  return form;
}

async function apiRequest(baseUrl, token, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

function record(results, passed, description, detail) {
  results.push({ passed, description, detail });
  console.log(`${passed ? "ok" : "not ok"} ${results.length} - ${description}`);
}

async function run() {
  const secretKey = requireEnvironmentVariable("CLERK_SECRET_KEY");
  const baseUrl = process.env.MOMENTS_TEST_BASE_URL?.trim() ?? "http://127.0.0.1:3000";
  const runId = randomUUID();
  const sourceId = `hosted-${runId}`;
  const identities = [];
  const created = [];
  const results = [];

  try {
    await cleanupStaleTestIdentities(secretKey);
    const owner = await createIdentity(secretKey, "owner", runId);
    identities.push(owner);
    const other = await createIdentity(secretKey, "other", runId);
    identities.push(other);

    const anonymous = await apiRequest(baseUrl, "", "/api/moments/import", {
      method: "POST",
      body: importBody(sourceId),
      headers: { Authorization: "" },
    });
    record(
      results,
      anonymous.status === 401,
      "an unauthenticated import request is denied",
      `status ${anonymous.status}`,
    );

    const [first, concurrent] = await Promise.all([
      apiRequest(baseUrl, owner.token, "/api/moments/import", {
        method: "POST",
        body: importBody(sourceId, { image: TEST_IMAGE }),
      }),
      apiRequest(baseUrl, owner.token, "/api/moments/import", {
        method: "POST",
        body: importBody(sourceId, { image: TEST_IMAGE }),
      }),
    ]);
    const firstBody = await first.json().catch(() => null);
    const concurrentBody = await concurrent.json().catch(() => null);
    const successfulResults = [firstBody?.result, concurrentBody?.result].filter(
      Boolean,
    );
    const importedId = successfulResults[0]?.moment?.id;
    if (importedId) created.push({ id: importedId, token: owner.token });
    record(
      results,
      [200, 201].includes(first.status) &&
        [200, 201].includes(concurrent.status) &&
        successfulResults.length === 2 &&
        new Set(successfulResults.map((result) => result.moment.id)).size === 1,
      "concurrent owner requests converge on one imported Moment",
      `statuses ${first.status}/${concurrent.status}`,
    );

    const ownerList = await apiRequest(baseUrl, owner.token, "/api/moments");
    const ownerMoments = (await ownerList.json().catch(() => null))?.moments;
    record(
      results,
      ownerList.ok &&
        Array.isArray(ownerMoments) &&
        ownerMoments.filter((moment) => moment.title === "Hosted import memory")
          .length === 1,
      "durable idempotency leaves exactly one owner row",
      `status ${ownerList.status}`,
    );

    const retry = await apiRequest(baseUrl, owner.token, "/api/moments/import", {
      method: "POST",
      body: importBody(sourceId, { image: TEST_IMAGE }),
    });
    const retryBody = await retry.json().catch(() => null);
    record(
      results,
      retry.status === 200 &&
        retryBody?.result?.outcome === "already_imported" &&
        retryBody?.result?.imageOutcome === "already_present" &&
        retryBody?.result?.moment?.id === importedId,
      "an authenticated retry returns the existing Moment and image",
      `status ${retry.status}`,
    );

    const conflict = await apiRequest(baseUrl, owner.token, "/api/moments/import", {
      method: "POST",
      body: importBody(sourceId, { title: "Changed after import" }),
    });
    record(
      results,
      conflict.status === 409,
      "changed content with the same source id is rejected",
      `status ${conflict.status}`,
    );

    const otherList = await apiRequest(baseUrl, other.token, "/api/moments");
    const otherMoments = (await otherList.json().catch(() => null))?.moments;
    record(
      results,
      otherList.ok &&
        Array.isArray(otherMoments) &&
        !otherMoments.some((moment) => moment.id === importedId),
      "another Clerk user cannot read the owner's imported Moment",
      `status ${otherList.status}`,
    );

    const ownerImage = await apiRequest(
      baseUrl,
      owner.token,
      `/api/moments/${importedId}/image`,
    );
    const otherImage = await apiRequest(
      baseUrl,
      other.token,
      `/api/moments/${importedId}/image`,
    );
    record(
      results,
      ownerImage.ok &&
        ownerImage.headers.get("content-type")?.startsWith("image/png") === true,
      "the owner can retrieve the imported private image",
      `status ${ownerImage.status}`,
    );
    record(
      results,
      otherImage.status === 404,
      "another Clerk user cannot retrieve the imported private image",
      `status ${otherImage.status}`,
    );

    const spoofed = new Blob([Buffer.from([0xff, 0xd8, 0xff])], {
      type: "image/png",
    });
    const invalidImage = await apiRequest(
      baseUrl,
      owner.token,
      "/api/moments/import",
      {
        method: "POST",
        body: importBody(`${sourceId}-spoof`, { image: spoofed }),
      },
    );
    record(
      results,
      invalidImage.status === 422,
      "server-side signature validation rejects a spoofed image",
      `status ${invalidImage.status}`,
    );

    const otherImport = await apiRequest(
      baseUrl,
      other.token,
      "/api/moments/import",
      { method: "POST", body: importBody(sourceId) },
    );
    const otherImportBody = await otherImport.json().catch(() => null);
    if (otherImportBody?.result?.moment?.id) {
      created.push({ id: otherImportBody.result.moment.id, token: other.token });
    }
    record(
      results,
      otherImport.status === 201 &&
        otherImportBody?.result?.moment?.id !== importedId,
      "database idempotency is owner-scoped while browser association remains a UI guard",
      `status ${otherImport.status}`,
    );

    const failures = results.filter((result) => !result.passed);
    if (failures.length > 0) {
      throw new Error(
        `Hosted import verification failed: ${failures
          .map((failure) => failure.detail)
          .filter(Boolean)
          .join("; ")}`,
      );
    }
  } finally {
    for (const item of created) {
      await apiRequest(baseUrl, item.token, `/api/moments/${item.id}`, {
        method: "DELETE",
      }).catch(() => null);
    }
    for (const identity of identities.reverse()) {
      await clerkRequest(secretKey, `/sessions/${identity.sessionId}/revoke`, {
        method: "POST",
      }).catch(() => null);
      await clerkRequest(secretKey, `/users/${identity.userId}`, {
        method: "DELETE",
      }).catch(() => null);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Hosted import verification failed.");
  process.exitCode = 1;
});
