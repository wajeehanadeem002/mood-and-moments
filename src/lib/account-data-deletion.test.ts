import { describe, expect, it, vi } from "vitest";

import {
  AccountDataDeletionIncompleteError,
  deleteAccountData,
  type AccountDataDeletionRepository,
} from "./account-data-deletion";

const operationId = "11111111-1111-4111-8111-111111111111";
const paths = [
  "user_a/00000000-0000-4000-8000-000000000001/image",
  "user_a/00000000-0000-4000-8000-000000000002/image",
];

function harness(options?: {
  beginError?: Error;
  listError?: Error;
  cleanupFailureAt?: number;
  completionFailureAt?: number;
  verificationError?: Error;
  verification?: {
    complete: boolean;
    remainingMoments: number;
    remainingStorageObjects: number;
    remainingCleanupAuthorizations: number;
    remainingDeletionJobs: number;
  };
}) {
  const order: string[] = [];
  const begin = vi.fn(async () => {
    order.push("begin");
    if (options?.beginError) throw options.beginError;
    return { operationId, deletedMoments: 2 };
  });
  const listCleanupPaths = vi.fn(async () => {
    order.push("list");
    if (options?.listError) throw options.listError;
    return paths;
  });
  let completionIndex = 0;
  const completeImageCleanup = vi.fn(async (path: string) => {
    order.push(`complete:${path}`);
    if (completionIndex++ === options?.completionFailureAt) {
      throw new Error("object remains present");
    }
  });
  const verifyAndFinish = vi.fn(async () => {
    order.push("verify");
    if (options?.verificationError) throw options.verificationError;
    return (
      options?.verification ?? {
        complete: true,
        remainingMoments: 0,
        remainingStorageObjects: 0,
        remainingCleanupAuthorizations: 0,
        remainingDeletionJobs: 0,
      }
    );
  });
  let removeIndex = 0;
  const remove = vi.fn(async (path: string) => {
    order.push(`remove:${path}`);
    if (removeIndex++ === options?.cleanupFailureAt) {
      throw new Error("private storage detail");
    }
  });
  const repository: AccountDataDeletionRepository = {
    begin,
    listCleanupPaths,
    completeImageCleanup,
    verifyAndFinish,
  };

  return {
    repository,
    images: { remove },
    order,
    begin,
    listCleanupPaths,
    completeImageCleanup,
    verifyAndFinish,
    remove,
  };
}

describe("deleteAccountData", () => {
  it("commits database deletion before sequential Storage cleanup and zero-state verification", async () => {
    const test = harness();

    await expect(
      deleteAccountData(test.repository, test.images),
    ).resolves.toEqual({ deletedMoments: 2, deletedImages: 2 });
    expect(test.order).toEqual([
      "begin",
      "list",
      `remove:${paths[0]}`,
      `complete:${paths[0]}`,
      `remove:${paths[1]}`,
      `complete:${paths[1]}`,
      "verify",
    ]);
  });

  it("performs no Storage work if atomic database preparation fails", async () => {
    const test = harness({ beginError: new Error("private database detail") });

    await expect(deleteAccountData(test.repository, test.images)).rejects.toThrow();
    expect(test.listCleanupPaths).not.toHaveBeenCalled();
    expect(test.remove).not.toHaveBeenCalled();
    expect(test.verifyAndFinish).not.toHaveBeenCalled();
  });

  it("fails closed with the approved incomplete error when cleanup listing fails after begin commits", async () => {
    const test = harness({ listError: new Error("private listing detail") });

    await expect(deleteAccountData(test.repository, test.images)).rejects.toEqual(
      expect.objectContaining({
        name: AccountDataDeletionIncompleteError.name,
        remainingMoments: null,
        remainingStorageObjects: null,
        remainingCleanupAuthorizations: null,
        remainingDeletionJobs: null,
      }),
    );
    expect(test.begin).toHaveBeenCalledOnce();
    expect(test.remove).not.toHaveBeenCalled();
    expect(test.verifyAndFinish).not.toHaveBeenCalled();
  });

  it("fails closed with the approved incomplete error when final verification fails after begin commits", async () => {
    const test = harness({
      verificationError: new Error("private verification detail"),
    });

    await expect(deleteAccountData(test.repository, test.images)).rejects.toEqual(
      expect.objectContaining({
        name: AccountDataDeletionIncompleteError.name,
        remainingMoments: null,
        remainingStorageObjects: null,
        remainingCleanupAuthorizations: null,
        remainingDeletionJobs: null,
      }),
    );
    expect(test.begin).toHaveBeenCalledOnce();
    expect(test.verifyAndFinish).toHaveBeenCalledWith(operationId);
  });

  it("leaves durable work for retry and returns incomplete when one Storage object cannot be removed", async () => {
    const test = harness({
      cleanupFailureAt: 0,
      completionFailureAt: 0,
      verification: {
        complete: false,
        remainingMoments: 0,
        remainingStorageObjects: 1,
        remainingCleanupAuthorizations: 1,
        remainingDeletionJobs: 1,
      },
    });

    await expect(deleteAccountData(test.repository, test.images)).rejects.toEqual(
      expect.objectContaining({
        name: AccountDataDeletionIncompleteError.name,
        remainingStorageObjects: 1,
        remainingCleanupAuthorizations: 1,
      }),
    );
    expect(test.completeImageCleanup).toHaveBeenCalledTimes(2);
    expect(test.verifyAndFinish).toHaveBeenCalledWith(operationId);
  });

  it("reconciles a nominal Storage remove failure when finalization proves everything is absent", async () => {
    const test = harness({ cleanupFailureAt: 0 });

    await expect(deleteAccountData(test.repository, test.images)).resolves.toEqual({
      deletedMoments: 2,
      deletedImages: 1,
    });
    expect(test.verifyAndFinish).toHaveBeenCalledWith(operationId);
    expect(test.completeImageCleanup).toHaveBeenCalledWith(paths[0]);
  });

  it("never reports success when final verification finds any remaining state", async () => {
    const test = harness({
      verification: {
        complete: false,
        remainingMoments: 1,
        remainingStorageObjects: 0,
        remainingCleanupAuthorizations: 0,
        remainingDeletionJobs: 1,
      },
    });

    await expect(deleteAccountData(test.repository, test.images)).rejects.toBeInstanceOf(
      AccountDataDeletionIncompleteError,
    );
  });

  it("is idempotent for an empty or already-completed cloud account", async () => {
    const test = harness();
    test.begin.mockResolvedValueOnce({ operationId, deletedMoments: 0 });
    test.listCleanupPaths.mockResolvedValueOnce([]);

    await expect(deleteAccountData(test.repository, test.images)).resolves.toEqual({
      deletedMoments: 0,
      deletedImages: 0,
    });
    expect(test.remove).not.toHaveBeenCalled();
  });

  it("lets concurrent requests share durable work without manufacturing success", async () => {
    const remaining = {
      complete: false,
      remainingMoments: 0,
      remainingStorageObjects: 1,
      remainingCleanupAuthorizations: 1,
      remainingDeletionJobs: 1,
    };
    const first = harness({ verification: remaining });

    const results = await Promise.allSettled([
      deleteAccountData(first.repository, first.images),
      deleteAccountData(first.repository, first.images),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(first.begin).toHaveBeenCalledTimes(2);
    expect(first.verifyAndFinish).toHaveBeenCalledTimes(2);
  });

  it("allows concurrent retries to converge only after the shared zero state is proven", async () => {
    const remaining = new Set(paths);
    const begin = vi.fn().mockResolvedValue({ operationId, deletedMoments: 2 });
    const listCleanupPaths = vi.fn().mockResolvedValue(paths);
    const remove = vi.fn(async (path: string) => {
      remaining.delete(path);
    });
    const completeImageCleanup = vi.fn(async () => undefined);
    const verifyAndFinish = vi.fn(async () => ({
      complete: remaining.size === 0,
      remainingMoments: 0,
      remainingStorageObjects: remaining.size,
      remainingCleanupAuthorizations: remaining.size,
      remainingDeletionJobs: remaining.size === 0 ? 0 : 1,
    }));
    const repository: AccountDataDeletionRepository = {
      begin,
      listCleanupPaths,
      completeImageCleanup,
      verifyAndFinish,
    };

    const results = await Promise.allSettled([
      deleteAccountData(repository, { remove }),
      deleteAccountData(repository, { remove }),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(remaining.size).toBe(0);
    expect(begin).toHaveBeenCalledTimes(2);
    expect(verifyAndFinish).toHaveBeenCalledTimes(2);
  });
});
