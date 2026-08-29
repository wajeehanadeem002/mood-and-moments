import type { Moment } from "@/data/moments";
import type { MomentImageMutation } from "@/lib/moment-request-validation";
import type {
  StoredMomentImage,
  SupabaseMomentImageRepository,
} from "@/repositories/supabase-moment-image-repository";
import {
  MomentNotFoundError,
  type StoredMomentRecord,
  type SupabaseMomentRepository,
} from "@/repositories/supabase-moment-repository";

type MomentStore = Pick<
  SupabaseMomentRepository,
  | "create"
  | "delete"
  | "findRecordById"
  | "list"
  | "update"
  | "updateWithImagePath"
>;

type MomentImageStore = Pick<
  SupabaseMomentImageRepository,
  "download" | "remove" | "replace" | "restore" | "upload"
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

function stableImagePath(userId: string, momentId: string) {
  if (!userId || userId.includes("/")) {
    throw new MomentImageLifecycleError(
      "The authenticated user identity cannot be used for image storage.",
    );
  }

  return `${userId}/${momentId}/image`;
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

    const path = stableImagePath(this.userId, created.id);

    try {
      await this.images.upload(path, image);
      return await this.moments.updateWithImagePath(created, path);
    } catch (cause) {
      const cleanupFailures = await runCleanup([
        () => this.images.remove(path),
        () => this.moments.delete(created.id),
      ]);

      throw new MomentImageLifecycleError(
        "Moment creation could not complete and was rolled back.",
        cleanupFailures,
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
      return this.moments.update(candidate);
    }

    if (imageMutation.kind === "remove") {
      return this.removeImage(record, candidate);
    }

    return this.replaceImage(record, candidate, imageMutation.image);
  }

  async delete(id: string): Promise<void> {
    const record = await this.moments.findRecordById(id);

    if (!record) {
      throw new MomentNotFoundError();
    }

    if (!record.imagePath) {
      await this.moments.delete(id);
      return;
    }

    const path = this.requireStablePath(record);
    const backup = await this.images.download(path);
    let removalAttempted = false;

    try {
      removalAttempted = true;
      await this.images.remove(path);
      await this.moments.delete(id);
    } catch (cause) {
      const cleanupFailures = removalAttempted
        ? await runCleanup([() => this.images.restore(path, backup)])
        : [];

      throw new MomentImageLifecycleError(
        "Moment deletion could not complete and was rolled back.",
        cleanupFailures,
        { cause },
      );
    }
  }

  async download(id: string): Promise<StoredMomentImage> {
    const record = await this.moments.findRecordById(id);

    if (!record?.imagePath) {
      throw new MomentNotFoundError();
    }

    return this.images.download(this.requireStablePath(record));
  }

  private async replaceImage(
    record: StoredMomentRecord,
    candidate: Moment,
    image: File,
  ): Promise<Moment> {
    const path = stableImagePath(this.userId, candidate.id);
    const backup = record.imagePath
      ? await this.images.download(this.requireStablePath(record))
      : null;
    let textUpdated = false;
    let objectMutationAttempted = false;

    try {
      const updated = await this.moments.update(candidate);
      textUpdated = true;
      objectMutationAttempted = true;

      if (backup) {
        await this.images.replace(path, image);
      } else {
        await this.images.upload(path, image);
      }

      return await this.moments.updateWithImagePath(updated, path);
    } catch (cause) {
      const cleanupActions: Array<() => Promise<unknown>> = [];

      if (objectMutationAttempted) {
        cleanupActions.push(
          backup
            ? () => this.images.restore(path, backup)
            : () => this.images.remove(path),
        );
      }

      if (textUpdated) {
        cleanupActions.push(() =>
          this.moments.updateWithImagePath(record.moment, record.imagePath),
        );
      }

      const cleanupFailures = await runCleanup(cleanupActions);

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
    if (!record.imagePath) {
      return this.moments.updateWithImagePath(candidate, null);
    }

    const path = this.requireStablePath(record);
    const backup = await this.images.download(path);
    let textUpdated = false;
    let removalAttempted = false;

    try {
      const updated = await this.moments.update(candidate);
      textUpdated = true;
      removalAttempted = true;
      await this.images.remove(path);

      return await this.moments.updateWithImagePath(updated, null);
    } catch (cause) {
      const cleanupActions: Array<() => Promise<unknown>> = [];

      if (removalAttempted) {
        cleanupActions.push(() => this.images.restore(path, backup));
      }

      if (textUpdated) {
        cleanupActions.push(() =>
          this.moments.updateWithImagePath(record.moment, record.imagePath),
        );
      }

      const cleanupFailures = await runCleanup(cleanupActions);

      throw new MomentImageLifecycleError(
        "Moment image removal could not complete and was rolled back.",
        cleanupFailures,
        { cause },
      );
    }
  }

  private requireStablePath(record: StoredMomentRecord): string {
    const expectedPath = stableImagePath(this.userId, record.moment.id);

    if (record.imagePath !== expectedPath) {
      throw new MomentImageLifecycleError(
        "The stored Moment image reference is invalid.",
      );
    }

    return expectedPath;
  }
}
