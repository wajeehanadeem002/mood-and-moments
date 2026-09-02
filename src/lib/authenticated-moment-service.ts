import type { Moment } from "@/data/moments";
import type { MomentImageMutation } from "@/lib/moment-request-validation";
import { sha256MomentImage } from "@/lib/moment-image-validation";
import {
  createMomentImagePath,
  isOwnedMomentImagePath,
} from "@/lib/moment-image-path";
import type {
  StoredMomentImage,
  SupabaseMomentImageRepository,
} from "@/repositories/supabase-moment-image-repository";
import {
  MomentNotFoundError,
  MomentVersionConflictError,
  type StoredMomentRecord,
  type SupabaseMomentRepository,
} from "@/repositories/supabase-moment-repository";

type MomentStore = Pick<
  SupabaseMomentRepository,
  | "create"
  | "authorizeImageCandidate"
  | "completeImageCleanup"
  | "deleteRecord"
  | "findRecordById"
  | "list"
  | "updateWithImagePath"
>;

type MomentImageStore = Pick<
  SupabaseMomentImageRepository,
  "download" | "remove" | "upload"
>;

export class MomentImageLifecycleError extends Error {
  constructor(
    message: string,
    public readonly cleanupFailures: readonly unknown[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MomentImageLifecycleError";
  }
}

async function runCleanup(
  actions: readonly (() => Promise<unknown>)[],
): Promise<unknown[]> {
  const failures: unknown[] = [];

  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }

  return failures;
}

export class AuthenticatedMomentService {
  constructor(
    private readonly moments: MomentStore,
    private readonly images: MomentImageStore,
    private readonly userId: string,
    private readonly createImageGeneration: () => string = () =>
      crypto.randomUUID(),
  ) {}

  list(): Promise<Moment[]> {
    return this.moments.list();
  }

  findRecordById(id: string): Promise<StoredMomentRecord | null> {
    return this.moments.findRecordById(id);
  }

  async create(moment: Moment, image: File | null): Promise<Moment> {
    const created = await this.moments.create(moment);

    if (!image) {
      return created;
    }

    const revision = this.requireRevision(created);
    const path = this.createImagePath(created.id);

    try {
      await this.moments.authorizeImageCandidate(created.id, revision, path);
      await this.images.upload(path, image);
      return (
        await this.moments.updateWithImagePath(created, path, null)
      ).moment;
    } catch (cause) {
      if (cause instanceof MomentVersionConflictError) {
        const cleanupFailures = await this.cleanupImage(path);
        throw new MomentVersionConflictError(
          cause.currentMoment,
          cleanupFailures,
        );
      }

      try {
        const latest = await this.moments.findRecordById(created.id);
        if (latest?.imagePath === path && latest.revision > revision) {
          return latest.moment;
        }
        if (latest && latest.revision !== revision) {
          const cleanupFailures = await this.cleanupImage(path);
          throw new MomentVersionConflictError(
            latest.moment,
            cleanupFailures,
          );
        }
      } catch (reconciliationCause) {
        if (reconciliationCause instanceof MomentVersionConflictError) {
          throw reconciliationCause;
        }
      }

      const cleanupFailures = await this.cleanupImage(path);

      const rollbackFailures = await runCleanup([
        () => this.moments.deleteRecord(created.id, revision),
      ]);

      throw new MomentImageLifecycleError(
        "Moment creation could not complete and was rolled back.",
        [...cleanupFailures, ...rollbackFailures],
        { cause },
      );
    }
  }

  async update(
    id: string,
    moment: Moment,
    imageMutation: MomentImageMutation,
  ): Promise<Moment> {
    const record = await this.moments.findRecordById(id);

    if (!record) {
      throw new MomentNotFoundError();
    }

    return this.updateRecord(record, moment, imageMutation);
  }

  async updateRecord(
    record: StoredMomentRecord,
    moment: Moment,
    imageMutation: MomentImageMutation,
  ): Promise<Moment> {
    const id = record.moment.id;

    const candidate = { ...moment, id };

    if (imageMutation.kind === "keep") {
      return (
        await this.moments.updateWithImagePath(
          candidate,
          record.imagePath,
          record.importImageHash,
        )
      ).moment;
    }

    if (imageMutation.kind === "remove") {
      return this.removeImage(record, candidate);
    }

    return this.replaceImage(record, candidate, imageMutation.image);
  }

  async delete(id: string, revision: number): Promise<void> {
    const record = await this.moments.findRecordById(id);
    if (!record) throw new MomentNotFoundError();

    let deletion;
    try {
      deletion = await this.moments.deleteRecord(id, revision);
    } catch (cause) {
      if (cause instanceof MomentNotFoundError) throw cause;
      if (cause instanceof MomentVersionConflictError) throw cause;

      try {
        const latest = await this.moments.findRecordById(id);
        if (!latest) {
          if (record.imagePath) {
            await this.cleanupCommittedImage(record.imagePath);
          }
          return;
        }
        if (latest.revision !== revision) {
          throw new MomentVersionConflictError(latest.moment);
        }
      } catch (reconciliationCause) {
        if (reconciliationCause instanceof MomentVersionConflictError) {
          throw reconciliationCause;
        }
        throw new MomentImageLifecycleError(
          "Moment deletion could not be reconciled.",
          [],
          { cause: reconciliationCause },
        );
      }

      throw new MomentImageLifecycleError(
        "Moment deletion could not complete.",
        [],
        { cause },
      );
    }
    if (deletion.cleanupPath) {
      await this.cleanupCommittedImage(deletion.cleanupPath);
    }
  }

  async download(id: string): Promise<StoredMomentImage> {
    const record = await this.moments.findRecordById(id);

    if (!record?.imagePath) {
      throw new MomentNotFoundError();
    }

    return this.images.download(this.requireOwnedPath(record));
  }

  private async replaceImage(
    record: StoredMomentRecord,
    candidate: Moment,
    image: File,
  ): Promise<Moment> {
    const path = this.createImagePath(candidate.id);
    const revision = this.requireRevision(candidate);
    let candidateAuthorized = false;

    try {
      const importImageHash =
        record.importSource === "legacy-localstorage-v1"
          ? await sha256MomentImage(image)
          : null;
      await this.moments.authorizeImageCandidate(
        candidate.id,
        revision,
        path,
      );
      candidateAuthorized = true;
      await this.images.upload(path, image);
      const updated = await this.moments.updateWithImagePath(
        candidate,
        path,
        importImageHash,
      );
      if (updated.cleanupPath) {
        await this.cleanupCommittedImage(updated.cleanupPath);
      }
      return updated.moment;
    } catch (cause) {
      if (cause instanceof MomentVersionConflictError) {
        const cleanupFailures = candidateAuthorized
          ? await this.cleanupImage(path)
          : [];
        throw new MomentVersionConflictError(
          cause.currentMoment,
          cleanupFailures,
        );
      }

      if (candidateAuthorized) {
        try {
          const latest = await this.moments.findRecordById(candidate.id);
          if (
            latest?.imagePath === path &&
            latest.revision > record.revision
          ) {
            if (record.imagePath) {
              await this.cleanupCommittedImage(record.imagePath);
            }
            return latest.moment;
          }
          if (latest && latest.revision !== record.revision) {
            const cleanupFailures = await this.cleanupImage(path);
            throw new MomentVersionConflictError(
              latest.moment,
              cleanupFailures,
            );
          }
        } catch (reconciliationCause) {
          if (reconciliationCause instanceof MomentVersionConflictError) {
            throw reconciliationCause;
          }
        }
      }

      const cleanupFailures = candidateAuthorized
        ? await this.cleanupImage(path)
        : [];

      throw new MomentImageLifecycleError(
        "Moment image replacement could not complete and was rolled back.",
        cleanupFailures,
        { cause },
      );
    }
  }

  private async removeImage(
    record: StoredMomentRecord,
    candidate: Moment,
  ): Promise<Moment> {
    try {
      const updated = await this.moments.updateWithImagePath(
        candidate,
        null,
        null,
      );
      if (updated.cleanupPath) {
        await this.cleanupCommittedImage(updated.cleanupPath);
      }
      return updated.moment;
    } catch (cause) {
      if (cause instanceof MomentVersionConflictError) {
        throw cause;
      }

      try {
        const latest = await this.moments.findRecordById(candidate.id);
        if (
          latest &&
          latest.revision > record.revision &&
          latest.imagePath === null
        ) {
          if (record.imagePath) {
            await this.cleanupCommittedImage(record.imagePath);
          }
          return latest.moment;
        }
        if (latest && latest.revision !== record.revision) {
          throw new MomentVersionConflictError(latest.moment);
        }
      } catch (reconciliationCause) {
        if (reconciliationCause instanceof MomentVersionConflictError) {
          throw reconciliationCause;
        }
      }

      throw new MomentImageLifecycleError(
        "Moment image removal could not complete and was rolled back.",
        [],
        { cause },
      );
    }
  }

  private createImagePath(momentId: string): string {
    try {
      return createMomentImagePath(
        this.userId,
        momentId,
        this.createImageGeneration(),
      );
    } catch (cause) {
      throw new MomentImageLifecycleError(
        "The authenticated Moment image path is invalid.",
        [],
        { cause },
      );
    }
  }

  private requireOwnedPath(record: StoredMomentRecord): string {
    if (
      !record.imagePath ||
      !isOwnedMomentImagePath(
        record.imagePath,
        this.userId,
        record.moment.id,
      )
    ) {
      throw new MomentImageLifecycleError(
        "The stored Moment image reference is invalid.",
      );
    }

    return record.imagePath;
  }

  private requireRevision(moment: Moment): number {
    if (!Number.isSafeInteger(moment.revision) || Number(moment.revision) < 1) {
      throw new MomentImageLifecycleError(
        "The current Moment revision is unavailable.",
      );
    }
    return moment.revision!;
  }

  private async cleanupImage(path: string): Promise<unknown[]> {
    const failures = await runCleanup([() => this.images.remove(path)]);
    if (failures.length === 0) {
      failures.push(
        ...(await runCleanup([
          () => this.moments.completeImageCleanup(path),
        ])),
      );
    }
    return failures;
  }

  private async cleanupCommittedImage(path: string): Promise<void> {
    const failures = await this.cleanupImage(path);
    if (failures.length > 0) {
      console.error(
        "Moment image cleanup remains durably authorized for retry.",
        failures,
      );
    }
  }
}
