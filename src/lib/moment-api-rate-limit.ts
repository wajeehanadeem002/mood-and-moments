import type { SupabaseClient } from "@supabase/supabase-js";

export type MomentApiRateLimitBucket =
  | "read"
  | "mutation"
  | "import"
  | "export";

export type MomentApiRateLimit = {
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const bucketLimits: Record<MomentApiRateLimitBucket, number> = {
  read: 120,
  mutation: 30,
  import: 10,
  export: 2,
};

type RateLimitRow = {
  allowed: boolean;
  limit_value: number;
  remaining: number;
  retry_after_seconds: number;
};

export class MomentApiRateLimitExceededError extends Error {
  constructor(public readonly rateLimit: MomentApiRateLimit) {
    super("The authenticated Moment API rate limit was exceeded.");
    this.name = "MomentApiRateLimitExceededError";
  }

  get limit() {
    return this.rateLimit.limit;
  }

  get remaining() {
    return this.rateLimit.remaining;
  }

  get retryAfterSeconds() {
    return this.rateLimit.retryAfterSeconds;
  }
}

export class MomentApiRateLimitUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The authenticated Moment API rate limiter is unavailable.", options);
    this.name = "MomentApiRateLimitUnavailableError";
  }
}

function isRateLimitRow(
  value: unknown,
  bucket: MomentApiRateLimitBucket,
): value is RateLimitRow {
  if (!value || typeof value !== "object") return false;

  const row = value as Partial<RateLimitRow>;
  const expectedLimit = bucketLimits[bucket];

  return (
    typeof row.allowed === "boolean" &&
    row.limit_value === expectedLimit &&
    Number.isInteger(row.remaining) &&
    row.remaining! >= 0 &&
    row.remaining! < expectedLimit &&
    (row.allowed || row.remaining === 0) &&
    Number.isInteger(row.retry_after_seconds) &&
    row.retry_after_seconds! >= 1 &&
    row.retry_after_seconds! <= 60
  );
}

export async function enforceMomentApiRateLimit(
  client: SupabaseClient,
  bucket: MomentApiRateLimitBucket,
): Promise<MomentApiRateLimit> {
  let result;

  try {
    result = await client.rpc(
      "consume_moment_api_rate_limit" as never,
      { requested_bucket: bucket } as never,
    );
  } catch (cause) {
    throw new MomentApiRateLimitUnavailableError({ cause });
  }

  const { data, error } = result;

  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (error || !isRateLimitRow(row, bucket)) {
    throw new MomentApiRateLimitUnavailableError(
      error ? { cause: error } : undefined,
    );
  }

  const rateLimit = {
    limit: row.limit_value,
    remaining: row.remaining,
    retryAfterSeconds: row.retry_after_seconds,
  };

  if (!row.allowed) {
    throw new MomentApiRateLimitExceededError(rateLimit);
  }

  return rateLimit;
}
