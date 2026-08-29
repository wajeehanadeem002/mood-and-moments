import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const CLERK_API_URL = "https://api.clerk.com/v1";
const BUCKET_NAME = "moment-images";
const TEST_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4yQAAAAASUVORK5CYII=",
  "base64",
);
const REPLACEMENT_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function requireEnvironmentVariable(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for the hosted Storage API test.`);
  }

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
    const message =
      body?.errors?.[0]?.long_message ??
      body?.errors?.[0]?.message ??
      `Clerk API request failed with status ${response.status}.`;

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function createTestIdentity(secretKey, label, runId) {
  const password = `Mm!${randomUUID()}9z`;
  const user = await clerkRequest(secretKey, "/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [`mood-moments-${label}-${runId}@example.com`],
      external_id: `mood-moments-storage-${label}-${runId}`,
      first_name: "Storage",
      last_name: `Test ${label}`,
      password,
    }),
  });
  const session = await clerkRequest(secretKey, "/sessions", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id }),
  });
  const token = await clerkRequest(secretKey, `/sessions/${session.id}/tokens`, {
    method: "POST",
    body: JSON.stringify({ expires_in_seconds: 120 }),
  });

  return { sessionId: session.id, token: token.jwt, userId: user.id };
}

function createAuthenticatedStorageClient(url, publishableKey, token) {
  return createClient(url, publishableKey, {
    accessToken: async () => token,
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function recordResult(results, passed, description, detail) {
  results.push({ passed, description, detail });
  console.log(`${passed ? "ok" : "not ok"} ${results.length} - ${description}`);
}

async function run() {
  const clerkSecretKey = requireEnvironmentVariable("CLERK_SECRET_KEY");
  const supabaseUrl = requireEnvironmentVariable("SUPABASE_URL");
  const publishableKey = requireEnvironmentVariable("SUPABASE_PUBLISHABLE_KEY");
  const runId = randomUUID();
  const identities = [];
  const results = [];
  let ownerClient;
  let objectPath;
  let objectMayExist = false;

  try {
    const owner = await createTestIdentity(clerkSecretKey, "owner", runId);
    identities.push(owner);
    const otherUser = await createTestIdentity(clerkSecretKey, "other", runId);
    identities.push(otherUser);

    ownerClient = createAuthenticatedStorageClient(
      supabaseUrl,
      publishableKey,
      owner.token,
    );
    const otherClient = createAuthenticatedStorageClient(
      supabaseUrl,
      publishableKey,
      otherUser.token,
    );
    objectPath = `${owner.userId}/${runId}/image`;

    const upload = await ownerClient.storage.from(BUCKET_NAME).upload(
      objectPath,
      TEST_IMAGE,
      { contentType: "image/png", upsert: false },
    );
    objectMayExist = !upload.error;
    recordResult(
      results,
      !upload.error && upload.data?.path === objectPath,
      "the owner can upload an isolated image inside their own folder",
      upload.error?.message,
    );

    const crossUserDownload = await otherClient.storage
      .from(BUCKET_NAME)
      .download(objectPath);
    recordResult(
      results,
      Boolean(crossUserDownload.error) && !crossUserDownload.data,
      "another authenticated user cannot read the owner's object",
      crossUserDownload.error?.message,
    );

    const ownerReplacement = await ownerClient.storage
      .from(BUCKET_NAME)
      .update(objectPath, REPLACEMENT_IMAGE, {
        contentType: "image/png",
        upsert: false,
      });
    const afterOwnerReplacement = await ownerClient.storage
      .from(BUCKET_NAME)
      .download(objectPath);
    const replacementBytes = afterOwnerReplacement.data
      ? Buffer.from(await afterOwnerReplacement.data.arrayBuffer())
      : null;
    recordResult(
      results,
      !ownerReplacement.error &&
        !afterOwnerReplacement.error &&
        replacementBytes?.equals(REPLACEMENT_IMAGE) === true,
      "the owner can replace their own object at the stable path",
      ownerReplacement.error?.message ?? afterOwnerReplacement.error?.message,
    );

    const crossUserReplacement = await otherClient.storage
      .from(BUCKET_NAME)
      .update(objectPath, TEST_IMAGE, {
        contentType: "image/png",
        upsert: false,
      });
    const afterCrossUserReplacement = await ownerClient.storage
      .from(BUCKET_NAME)
      .download(objectPath);
    const preservedBytes = afterCrossUserReplacement.data
      ? Buffer.from(await afterCrossUserReplacement.data.arrayBuffer())
      : null;
    recordResult(
      results,
      Boolean(crossUserReplacement.error) &&
        !afterCrossUserReplacement.error &&
        preservedBytes?.equals(REPLACEMENT_IMAGE) === true,
      "another authenticated user cannot replace the owner's object",
      crossUserReplacement.error?.message ??
        afterCrossUserReplacement.error?.message,
    );

    const ownerRestore = await ownerClient.storage
      .from(BUCKET_NAME)
      .upload(objectPath, TEST_IMAGE, {
        contentType: "image/png",
        upsert: true,
      });
    const afterOwnerRestore = await ownerClient.storage
      .from(BUCKET_NAME)
      .download(objectPath);
    const restoredBytes = afterOwnerRestore.data
      ? Buffer.from(await afterOwnerRestore.data.arrayBuffer())
      : null;
    recordResult(
      results,
      !ownerRestore.error &&
        !afterOwnerRestore.error &&
        restoredBytes?.equals(TEST_IMAGE) === true,
      "the owner-scoped policies permit compensating object restoration",
      ownerRestore.error?.message ?? afterOwnerRestore.error?.message,
    );

    const crossUserDelete = await otherClient.storage
      .from(BUCKET_NAME)
      .remove([objectPath]);
    const afterCrossUserDelete = await ownerClient.storage
      .from(BUCKET_NAME)
      .download(objectPath);
    recordResult(
      results,
      !afterCrossUserDelete.error && Boolean(afterCrossUserDelete.data),
      "another authenticated user cannot delete the owner's object",
      crossUserDelete.error?.message ?? afterCrossUserDelete.error?.message,
    );

    const invalidMimePath = `${owner.userId}/${randomUUID()}/image`;
    const invalidMimeUpload = await ownerClient.storage
      .from(BUCKET_NAME)
      .upload(invalidMimePath, Buffer.from("not an image"), {
        contentType: "text/plain",
        upsert: false,
      });
    recordResult(
      results,
      Boolean(invalidMimeUpload.error),
      "the bucket rejects unsupported MIME types",
      invalidMimeUpload.error?.message,
    );

    const oversizedPath = `${owner.userId}/${randomUUID()}/image`;
    const oversizedUpload = await ownerClient.storage
      .from(BUCKET_NAME)
      .upload(oversizedPath, Buffer.alloc(1_000_001), {
        contentType: "image/png",
        upsert: false,
      });
    recordResult(
      results,
      Boolean(oversizedUpload.error),
      "the bucket rejects images larger than one million bytes",
      oversizedUpload.error?.message,
    );

    const ownerDelete = await ownerClient.storage
      .from(BUCKET_NAME)
      .remove([objectPath]);
    const afterOwnerDelete = await ownerClient.storage
      .from(BUCKET_NAME)
      .download(objectPath);
    const ownerDeletedObject =
      !ownerDelete.error && Boolean(afterOwnerDelete.error) && !afterOwnerDelete.data;
    recordResult(
      results,
      ownerDeletedObject,
      "the owner can delete their own object through the Storage API",
      ownerDelete.error?.message,
    );
    objectMayExist = !ownerDeletedObject;

    const failures = results.filter((result) => !result.passed);
    if (failures.length > 0) {
      const details = failures
        .map((failure) => failure.detail)
        .filter(Boolean)
        .join("; ");
      throw new Error(
        `Storage API verification failed${details ? `: ${details}` : "."}`,
      );
    }
  } finally {
    if (objectMayExist && ownerClient && objectPath) {
      await ownerClient.storage.from(BUCKET_NAME).remove([objectPath]);
    }

    for (const identity of identities.reverse()) {
      await clerkRequest(clerkSecretKey, `/sessions/${identity.sessionId}/revoke`, {
        method: "POST",
      }).catch(() => null);
      await clerkRequest(clerkSecretKey, `/users/${identity.userId}`, {
        method: "DELETE",
      });
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Storage API test failed.");
  process.exitCode = 1;
});
