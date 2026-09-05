import type { AccountDataDeletionRepository } from "@/repositories/supabase-account-data-deletion-repository";

type ImageRemover = {
  remove(path: string): Promise<void>;
};

export { type AccountDataDeletionRepository } from "@/repositories/supabase-account-data-deletion-repository";

export class AccountDataDeletionIncompleteError extends Error {
  constructor(
    public readonly remainingMoments: number | null,
    public readonly remainingStorageObjects: number | null,
    public readonly remainingCleanupAuthorizations: number | null,
    public readonly remainingDeletionJobs: number | null,
    options?: ErrorOptions,
  ) {
    super("Account data deletion could not be completely verified.", options);
    this.name = "AccountDataDeletionIncompleteError";
  }
}

export async function deleteAccountData(
  repository: AccountDataDeletionRepository,
  images: ImageRemover,
): Promise<{ deletedMoments: number; deletedImages: number }> {
  const started = await repository.begin();
  try {
    const paths = await repository.listCleanupPaths();
    let deletedImages = 0;

    for (const path of paths) {
      try {
        await images.remove(path);
        deletedImages += 1;
      } catch {
        // A lost remove response can still mean the object is already absent.
      }

      try {
        await repository.completeImageCleanup(path);
      } catch {
        // The durable authorization remains when the object is still present.
      }
    }

    const verification = await repository.verifyAndFinish(started.operationId);
    if (!verification.complete) {
      throw new AccountDataDeletionIncompleteError(
        verification.remainingMoments,
        verification.remainingStorageObjects,
        verification.remainingCleanupAuthorizations,
        verification.remainingDeletionJobs,
      );
    }

    return { deletedMoments: started.deletedMoments, deletedImages };
  } catch (error) {
    if (error instanceof AccountDataDeletionIncompleteError) throw error;

    throw new AccountDataDeletionIncompleteError(
      null,
      null,
      null,
      null,
      { cause: error },
    );
  }
}
