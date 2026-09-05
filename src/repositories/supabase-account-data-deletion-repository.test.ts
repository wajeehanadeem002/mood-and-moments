import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AccountDataDeletionPersistenceError,
  SupabaseAccountDataDeletionRepository,
} from "./supabase-account-data-deletion-repository";

const ownerId = "user_a";
const momentId = "00000000-0000-4000-8000-000000000001";
const operationId = "11111111-1111-4111-8111-111111111111";

function clientWith(options: {
  queryResults?: Array<{ data: unknown; error: unknown }>;
  rpcResults?: Array<{ data: unknown; error: unknown }>;
}) {
  let queryIndex = 0;
  let rpcIndex = 0;
  const queries: Array<{
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  }> = [];
  const from = vi.fn(() => {
    const result = options.queryResults?.[queryIndex++] ?? {
      data: [],
      error: null,
    };
    const query = {
      order: vi.fn(),
      range: vi.fn().mockResolvedValue(result),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    queries.push(query);
    return query;
  });
  const rpc = vi.fn(async () =>
    options.rpcResults?.[rpcIndex++] ?? { data: null, error: null },
  );

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    queries,
    rpc,
  };
}

function cleanupPath(index: number) {
  const id = index.toString(16).padStart(12, "0");
  return `${ownerId}/${momentId}/00000000-0000-4000-8000-${id}`;
}

describe("SupabaseAccountDataDeletionRepository", () => {
  it("starts or resumes the authenticated owner's durable deletion job", async () => {
    const { client, rpc } = clientWith({
      rpcResults: [
        {
          data: [{ operation_id: operationId, deleted_moments: 3 }],
          error: null,
        },
      ],
    });
    const repository = new SupabaseAccountDataDeletionRepository(
      client,
      ownerId,
    );

    await expect(repository.begin()).resolves.toEqual({
      operationId,
      deletedMoments: 3,
    });
    expect(rpc).toHaveBeenCalledWith("begin_account_data_deletion");
  });

  it("returns every owner-visible cleanup path across stable pages", async () => {
    const paths = Array.from({ length: 1001 }, (_, index) => cleanupPath(index));
    const { client, queries } = clientWith({
      queryResults: [
        { data: paths.slice(0, 500).map((image_path) => ({ image_path })), error: null },
        { data: paths.slice(500, 1000).map((image_path) => ({ image_path })), error: null },
        { data: paths.slice(1000).map((image_path) => ({ image_path })), error: null },
      ],
    });
    const repository = new SupabaseAccountDataDeletionRepository(
      client,
      ownerId,
    );

    await expect(repository.listCleanupPaths()).resolves.toEqual(paths);
    expect(queries).toHaveLength(3);
    expect(queries[0]!.order).toHaveBeenCalledWith("image_path", {
      ascending: true,
    });
    expect(queries[0]!.range).toHaveBeenCalledWith(0, 499);
    expect(queries[2]!.range).toHaveBeenCalledWith(1000, 1499);
  });

  it.each([
    {
      name: "duplicate path",
      rows: [{ image_path: cleanupPath(1) }, { image_path: cleanupPath(1) }],
    },
    {
      name: "cross-owner path",
      rows: [{ image_path: `user_b/${momentId}/image` }],
    },
    { name: "malformed row", rows: [{ image_path: null }] },
  ])("fails closed for a $name", async ({ rows }) => {
    const { client } = clientWith({ queryResults: [{ data: rows, error: null }] });
    const repository = new SupabaseAccountDataDeletionRepository(
      client,
      ownerId,
    );

    await expect(repository.listCleanupPaths()).rejects.toBeInstanceOf(
      AccountDataDeletionPersistenceError,
    );
  });

  it("completes an absent object's durable cleanup authorization", async () => {
    const path = cleanupPath(3);
    const { client, rpc } = clientWith({
      rpcResults: [{ data: [{ outcome: "completed" }], error: null }],
    });
    const repository = new SupabaseAccountDataDeletionRepository(
      client,
      ownerId,
    );

    await expect(repository.completeImageCleanup(path)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("complete_moment_image_cleanup", {
      requested_image_path: path,
    });
  });

  it("finishes only a database-verified zero state for the same operation", async () => {
    const { client, rpc } = clientWith({
      rpcResults: [
        {
          data: [
            {
              outcome: "complete",
              remaining_moments: 0,
              remaining_storage_objects: 0,
              remaining_cleanup_authorizations: 0,
              remaining_deletion_jobs: 0,
            },
          ],
          error: null,
        },
      ],
    });
    const repository = new SupabaseAccountDataDeletionRepository(
      client,
      ownerId,
    );

    await expect(repository.verifyAndFinish(operationId)).resolves.toEqual({
      complete: true,
      remainingMoments: 0,
      remainingStorageObjects: 0,
      remainingCleanupAuthorizations: 0,
      remainingDeletionJobs: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      "verify_and_finish_account_data_deletion",
      { requested_operation_id: operationId },
    );
  });

  it("reports a verified incomplete state without exposing provider details", async () => {
    const { client } = clientWith({
      rpcResults: [
        {
          data: [
            {
              outcome: "incomplete",
              remaining_moments: 0,
              remaining_storage_objects: 1,
              remaining_cleanup_authorizations: 1,
              remaining_deletion_jobs: 1,
            },
          ],
          error: null,
        },
      ],
    });
    const repository = new SupabaseAccountDataDeletionRepository(
      client,
      ownerId,
    );

    await expect(repository.verifyAndFinish(operationId)).resolves.toEqual({
      complete: false,
      remainingMoments: 0,
      remainingStorageObjects: 1,
      remainingCleanupAuthorizations: 1,
      remainingDeletionJobs: 1,
    });
  });

  it("fails closed on malformed privileged RPC output", async () => {
    const { client } = clientWith({
      rpcResults: [{ data: [{ outcome: "complete", remaining_moments: 1 }], error: null }],
    });
    const repository = new SupabaseAccountDataDeletionRepository(
      client,
      ownerId,
    );

    await expect(repository.verifyAndFinish(operationId)).rejects.toBeInstanceOf(
      AccountDataDeletionPersistenceError,
    );
  });
});
