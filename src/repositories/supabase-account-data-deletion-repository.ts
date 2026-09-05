import type { SupabaseClient } from "@supabase/supabase-js";

import { isOwnedMomentImagePath } from "@/lib/moment-image-path";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cleanupPageSize = 500;

export type AccountDataDeletionStart = {
  operationId: string;
  deletedMoments: number;
};

export type AccountDataDeletionVerification = {
  complete: boolean;
  remainingMoments: number;
  remainingStorageObjects: number;
  remainingCleanupAuthorizations: number;
  remainingDeletionJobs: number;
};

export interface AccountDataDeletionRepository {
  begin(): Promise<AccountDataDeletionStart>;
  listCleanupPaths(): Promise<string[]>;
  completeImageCleanup(imagePath: string): Promise<void>;
  verifyAndFinish(operationId: string): Promise<AccountDataDeletionVerification>;
}

export class AccountDataDeletionPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccountDataDeletionPersistenceError";
  }
}

function persistenceError(operation: string, cause?: unknown): never {
  throw new AccountDataDeletionPersistenceError(
    `Could not ${operation} account data deletion in Supabase.`,
    cause === undefined ? undefined : { cause },
  );
}

function singleObject(value: unknown): Record<string, unknown> {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !value[0] ||
    typeof value[0] !== "object"
  ) {
    persistenceError("validate");
  }

  return value[0] as Record<string, unknown>;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export class SupabaseAccountDataDeletionRepository
  implements AccountDataDeletionRepository
{
  constructor(
    private readonly client: SupabaseClient,
    private readonly ownerId: string,
  ) {
    if (!ownerId || ownerId.includes("/")) {
      throw new AccountDataDeletionPersistenceError(
        "The authenticated account identity is invalid.",
      );
    }
  }

  async begin(): Promise<AccountDataDeletionStart> {
    const { data, error } = await this.client.rpc(
      "begin_account_data_deletion" as never,
    );
    if (error) persistenceError("begin", error);

    const row = singleObject(data);
    if (
      typeof row.operation_id !== "string" ||
      !uuidPattern.test(row.operation_id) ||
      !isNonNegativeInteger(row.deleted_moments)
    ) {
      persistenceError("validate");
    }

    return {
      operationId: row.operation_id,
      deletedMoments: row.deleted_moments,
    };
  }

  async listCleanupPaths(): Promise<string[]> {
    const paths: string[] = [];
    const seen = new Set<string>();

    for (let offset = 0; ; offset += cleanupPageSize) {
      const { data, error } = await this.client
        .from("moment_image_cleanup_authorizations")
        .select("image_path")
        .order("image_path", { ascending: true })
        .range(offset, offset + cleanupPageSize - 1);

      if (error) persistenceError("load", error);
      if (!Array.isArray(data)) persistenceError("validate");

      for (const value of data) {
        const imagePath =
          value && typeof value === "object"
            ? (value as Record<string, unknown>).image_path
            : null;
        const momentId =
          typeof imagePath === "string" ? imagePath.split("/")[1] ?? "" : "";
        if (
          typeof imagePath !== "string" ||
          !isOwnedMomentImagePath(imagePath, this.ownerId, momentId) ||
          seen.has(imagePath)
        ) {
          persistenceError("validate");
        }

        seen.add(imagePath);
        paths.push(imagePath);
      }

      if (data.length < cleanupPageSize) return paths;
    }
  }

  async completeImageCleanup(imagePath: string): Promise<void> {
    const momentId = imagePath.split("/")[1] ?? "";
    if (!isOwnedMomentImagePath(imagePath, this.ownerId, momentId)) {
      persistenceError("validate");
    }

    const { data, error } = await this.client.rpc(
      "complete_moment_image_cleanup" as never,
      { requested_image_path: imagePath } as never,
    );
    if (error) persistenceError("complete image cleanup for", error);

    const outcome = singleObject(data).outcome;
    if (outcome !== "completed" && outcome !== "not_found") {
      persistenceError("complete image cleanup for");
    }
  }

  async verifyAndFinish(
    operationId: string,
  ): Promise<AccountDataDeletionVerification> {
    if (!uuidPattern.test(operationId)) persistenceError("validate");

    const { data, error } = await this.client.rpc(
      "verify_and_finish_account_data_deletion" as never,
      { requested_operation_id: operationId } as never,
    );
    if (error) persistenceError("verify", error);

    const row = singleObject(data);
    const outcome = row.outcome;
    if (
      (outcome !== "complete" && outcome !== "incomplete") ||
      !isNonNegativeInteger(row.remaining_moments) ||
      !isNonNegativeInteger(row.remaining_storage_objects) ||
      !isNonNegativeInteger(row.remaining_cleanup_authorizations) ||
      !isNonNegativeInteger(row.remaining_deletion_jobs)
    ) {
      persistenceError("validate");
    }

    const complete = outcome === "complete";
    const counts = [
      row.remaining_moments,
      row.remaining_storage_objects,
      row.remaining_cleanup_authorizations,
      row.remaining_deletion_jobs,
    ];
    if ((complete && counts.some((count) => count !== 0)) ||
      (!complete && counts.every((count) => count === 0))) {
      persistenceError("validate");
    }

    return {
      complete,
      remainingMoments: row.remaining_moments,
      remainingStorageObjects: row.remaining_storage_objects,
      remainingCleanupAuthorizations: row.remaining_cleanup_authorizations,
      remainingDeletionJobs: row.remaining_deletion_jobs,
    };
  }
}
