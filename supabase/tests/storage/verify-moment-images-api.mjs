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

function createStorageClient(url, publishableKey, token) {
  return createClient(url, publishableKey, {
    ...(token ? { accessToken: async () => token } : {}),
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function createTestMoment(client, label) {
  const { data, error } = await client
    .from("moments")
    .insert({
      title: `${label} Storage Moment`,
      description: "An isolated Moment created for Storage RLS verification.",
      mood: "calm",
      moment_date: "2026-08-30",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      error?.message ?? "Could not create a Moment for Storage verification.",
    );
  }

  return data.id;
}

function recordResult(results, passed, description, detail) {
  results.push({ passed, description, detail });
  console.log(`${passed ? "ok" : "not ok"} ${results.length} - ${description}`);
}

async function readBytes(client, objectPath) {
  const download = await client.storage.from(BUCKET_NAME).download(objectPath);
  const bytes = download.data
    ? Buffer.from(await download.data.arrayBuffer())
    : null;

  return { bytes, error: download.error };
}

async function runCleanupStep(cleanupErrors, description, action) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cleanup error.";
    cleanupErrors.push(new Error(`${description}: ${message}`));
  }
}

async function run() {
  const clerkSecretKey = requireEnvironmentVariable("CLERK_SECRET_KEY");
  const supabaseUrl = requireEnvironmentVariable("SUPABASE_URL");
  const publishableKey = requireEnvironmentVariable("SUPABASE_PUBLISHABLE_KEY");
  const runId = randomUUID();
  const identities = [];
  const results = [];
  const cleanupObjects = [];
  const cleanupMoments = [];
  let verificationError;

  try {
    const owner = await createTestIdentity(clerkSecretKey, "owner", runId);
    identities.push(owner);
    const otherUser = await createTestIdentity(clerkSecretKey, "other", runId);
    identities.push(otherUser);

    const ownerClient = createStorageClient(
      supabaseUrl,
      publishableKey,
      owner.token,
    );
    const otherClient = createStorageClient(
      supabaseUrl,
      publishableKey,
      otherUser.token,
    );
    const anonymousClient = createStorageClient(supabaseUrl, publishableKey);

    const ownerMomentId = await createTestMoment(ownerClient, "Owner");
    cleanupMoments.push({ client: ownerClient, id: ownerMomentId });
    const ownerEmptyMomentId = await createTestMoment(ownerClient, "Owner Empty");
    cleanupMoments.push({ client: ownerClient, id: ownerEmptyMomentId });
    const otherMomentId = await createTestMoment(otherClient, "Other User");
    cleanupMoments.push({ client: otherClient, id: otherMomentId });

    const objectPath = `${owner.userId}/${ownerMomentId}/image`;
    const upload = await ownerClient.storage.from(BUCKET_NAME).upload(
      objectPath,
      TEST_IMAGE,
      { contentType: "image/png", upsert: false },
    );
    if (!upload.error) {
      cleanupObjects.push({ client: ownerClient, path: objectPath });
    }
    recordResult(
      results,
      !upload.error && upload.data?.path === objectPath,
      "the owner can upload the exact canonical path for their own Moment",
      upload.error?.message,
    );

    const ownerRead = await readBytes(ownerClient, objectPath);
    recordResult(
      results,
      !ownerRead.error && ownerRead.bytes?.equals(TEST_IMAGE) === true,
      "the owner can read their own canonical Moment image",
      ownerRead.error?.message,
    );

    const anonymousDownload = await anonymousClient.storage
      .from(BUCKET_NAME)
      .download(objectPath);
    recordResult(
      results,
      Boolean(anonymousDownload.error) && !anonymousDownload.data,
      "an anonymous user cannot read a private Moment image",
      anonymousDownload.error?.message,
    );

    const anonymousUploadPath = `${owner.userId}/${ownerEmptyMomentId}/image`;
    const anonymousUpload = await anonymousClient.storage
      .from(BUCKET_NAME)
      .upload(anonymousUploadPath, TEST_IMAGE, {
        contentType: "image/png",
        upsert: false,
      });
    recordResult(
      results,
      Boolean(anonymousUpload.error),
      "an anonymous user cannot insert a canonical Moment image",
      anonymousUpload.error?.message,
    );

    const anonymousReplacement = await anonymousClient.storage
      .from(BUCKET_NAME)
      .update(objectPath, REPLACEMENT_IMAGE, {
        contentType: "image/png",
        upsert: false,
      });
    const afterAnonymousReplacement = await readBytes(ownerClient, objectPath);
    recordResult(
      results,
      Boolean(anonymousReplacement.error) &&
        !afterAnonymousReplacement.error &&
        afterAnonymousReplacement.bytes?.equals(TEST_IMAGE) === true,
      "an anonymous user cannot update an owner's Moment image",
      anonymousReplacement.error?.message ??
        afterAnonymousReplacement.error?.message,
    );

    const anonymousDelete = await anonymousClient.storage
      .from(BUCKET_NAME)
      .remove([objectPath]);
    const afterAnonymousDelete = await readBytes(ownerClient, objectPath);
    recordResult(
      results,
      !afterAnonymousDelete.error &&
        afterAnonymousDelete.bytes?.equals(TEST_IMAGE) === true,
      "an anonymous user cannot delete an owner's Moment image",
      anonymousDelete.error?.message ?? afterAnonymousDelete.error?.message,
    );

    const invalidPaths = [
      {
        description: "a wrong-owner folder is denied",
        path: `${otherUser.userId}/${ownerMomentId}/image`,
      },
      {
        description: "a non-existent Moment ID is denied",
        path: `${owner.userId}/${randomUUID()}/image`,
      },
      {
        description: "a Moment owned by another user is denied",
        path: `${owner.userId}/${otherMomentId}/image`,
      },
      {
        description: "an invalid UUID path segment is denied",
        path: `${owner.userId}/not-a-uuid/image`,
      },
      {
        description: "a wrong final path segment is denied",
        path: `${owner.userId}/${ownerMomentId}/thumbnail`,
      },
      {
        description: "a path with too few segments is denied",
        path: `${owner.userId}/${ownerMomentId}`,
      },
      {
        description: "a path with too many segments is denied",
        path: `${owner.userId}/${ownerMomentId}/image/extra`,
      },
      {
        description: "an arbitrary object name under the owner folder is denied",
        path: `${owner.userId}/arbitrary-object`,
      },
    ];

    for (const invalidPath of invalidPaths) {
      const attempt = await ownerClient.storage
        .from(BUCKET_NAME)
        .upload(invalidPath.path, TEST_IMAGE, {
          contentType: "image/png",
          upsert: false,
        });
      if (!attempt.error) {
        cleanupObjects.push({
          client: ownerClient,
          path: invalidPath.path,
        });
      }
      recordResult(
        results,
        Boolean(attempt.error),
        invalidPath.description,
        attempt.error?.message,
      );
    }

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
    const afterOwnerReplacement = await readBytes(ownerClient, objectPath);
    recordResult(
      results,
      !ownerReplacement.error &&
        !afterOwnerReplacement.error &&
        afterOwnerReplacement.bytes?.equals(REPLACEMENT_IMAGE) === true,
      "the owner can update their own object at the stable canonical path",
      ownerReplacement.error?.message ?? afterOwnerReplacement.error?.message,
    );

    const crossUserReplacement = await otherClient.storage
      .from(BUCKET_NAME)
      .update(objectPath, TEST_IMAGE, {
        contentType: "image/png",
        upsert: false,
      });
    const afterCrossUserReplacement = await readBytes(ownerClient, objectPath);
    recordResult(
      results,
      Boolean(crossUserReplacement.error) &&
        !afterCrossUserReplacement.error &&
        afterCrossUserReplacement.bytes?.equals(REPLACEMENT_IMAGE) === true,
      "another authenticated user cannot update the owner's object",
      crossUserReplacement.error?.message ??
        afterCrossUserReplacement.error?.message,
    );

    const ownerRestore = await ownerClient.storage
      .from(BUCKET_NAME)
      .upload(objectPath, TEST_IMAGE, {
        contentType: "image/png",
        upsert: true,
      });
    const afterOwnerRestore = await readBytes(ownerClient, objectPath);
    recordResult(
      results,
      !ownerRestore.error &&
        !afterOwnerRestore.error &&
        afterOwnerRestore.bytes?.equals(TEST_IMAGE) === true,
      "the owner-scoped policies permit compensating object restoration",
      ownerRestore.error?.message ?? afterOwnerRestore.error?.message,
    );

    const crossUserDelete = await otherClient.storage
      .from(BUCKET_NAME)
      .remove([objectPath]);
    const afterCrossUserDelete = await readBytes(ownerClient, objectPath);
    recordResult(
      results,
      !afterCrossUserDelete.error &&
        afterCrossUserDelete.bytes?.equals(TEST_IMAGE) === true,
      "another authenticated user cannot delete the owner's object",
      crossUserDelete.error?.message ?? afterCrossUserDelete.error?.message,
    );

    const invalidMimePath = `${owner.userId}/${ownerEmptyMomentId}/image`;
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

    const oversizedUpload = await ownerClient.storage
      .from(BUCKET_NAME)
      .upload(invalidMimePath, Buffer.alloc(1_000_001), {
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
    recordResult(
      results,
      !ownerDelete.error && Boolean(afterOwnerDelete.error) && !afterOwnerDelete.data,
      "the owner can delete their own object through the Storage API",
      ownerDelete.error?.message,
    );

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
  } catch (error) {
    verificationError =
      error instanceof Error ? error : new Error("Storage API test failed.");
  }

  const cleanupErrors = [];

  for (const [index, object] of cleanupObjects.reverse().entries()) {
    await runCleanupStep(
      cleanupErrors,
      `Storage object cleanup ${index + 1}`,
      async () => {
        const removal = await object.client.storage
          .from(BUCKET_NAME)
          .remove([object.path]);
        if (removal.error) {
          throw removal.error;
        }

        const remaining = await object.client.storage
          .from(BUCKET_NAME)
          .download(object.path);
        if (!remaining.error || remaining.data) {
          throw new Error("The object remained readable after cleanup.");
        }
      },
    );
  }

  for (const [index, moment] of cleanupMoments.reverse().entries()) {
    await runCleanupStep(
      cleanupErrors,
      `Moment cleanup ${index + 1}`,
      async () => {
        const deletion = await moment.client
          .from("moments")
          .delete()
          .eq("id", moment.id)
          .select("id");
        if (deletion.error) {
          throw deletion.error;
        }
        if (!deletion.data?.some((row) => row.id === moment.id)) {
          throw new Error("The expected test Moment was not deleted.");
        }
      },
    );
  }

  for (const [index, identity] of identities.reverse().entries()) {
    await runCleanupStep(
      cleanupErrors,
      `Clerk session cleanup ${index + 1}`,
      async () => {
        await clerkRequest(
          clerkSecretKey,
          `/sessions/${identity.sessionId}/revoke`,
          { method: "POST" },
        );
      },
    );
    await runCleanupStep(
      cleanupErrors,
      `Clerk user cleanup ${index + 1}`,
      async () => {
        await clerkRequest(clerkSecretKey, `/users/${identity.userId}`, {
          method: "DELETE",
        });
      },
    );
  }

  if (verificationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [verificationError, ...cleanupErrors],
      `${verificationError.message} Cleanup also failed: ${cleanupErrors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  if (verificationError) {
    throw verificationError;
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `Storage API verification cleanup failed: ${cleanupErrors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Storage API test failed.");
  process.exitCode = 1;
});
