import type { Moment } from "@/data/moments";
import {
  createMomentImagePath,
  isOwnedMomentImagePath,
} from "@/lib/moment-image-path";
import { sha256MomentImage } from "@/lib/moment-image-validation";
import type { SupabaseMomentImageRepository } from "@/repositories/supabase-moment-image-repository";
import {
  MomentImportConflictError,
  MomentVersionConflictError,
  type StoredImportedMomentRecord,
  type SupabaseMomentRepository,
} from "@/repositories/supabase-moment-repository";

type ImportMomentStore = Pick<
  SupabaseMomentRepository,
  | "authorizeImageCandidate"
  | "completeImageCleanup"
  | "createImported"
  | "findImportRecord"
  | "updateWithImagePath"
>;

type ImportImageStore = Pick<
  SupabaseMomentImageRepository,
  "download" | "remove" | "upload"
>;

type Pause = (milliseconds: number) => Promise<void>;

const concurrentImagePollAttempts = 30;
const concurrentImagePollIntervalMs = 150;

const defaultPause: Pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export type LegacyMomentImportSource = {
  sourceId: string;
  sourceHash: string;
  time: string;
};

export type LegacyMomentImportOutcome = {
  outcome:
    | "created"
    | "already_imported"
    | "completed_existing"
    | "image_mismatch";
  imageOutcome:
    | "uploaded"
    | "already_present"
    | "not_provided"
    | "mismatch";
  sourceId: string;
  sourceHash: string;
  moment: Moment;
};

export class LegacyImportSourceConflictError extends Error {
  constructor() {
    super("This legacy source id was already imported with different content.");
    this.name = "LegacyImportSourceConflictError";
  }
}

export class MomentImportLifecycleError extends Error {
  constructor(
    message: string,
    public readonly cleanupFailures: readonly unknown[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MomentImportLifecycleError";
  }
}

export class AuthenticatedMomentImportService {
  constructor(
    private readonly moments: ImportMomentStore,
    private readonly images: ImportImageStore,
    private readonly userId: string,
    private readonly pause: Pause = defaultPause,
    private readonly createImageGeneration: () => string = () =>
      crypto.randomUUID(),
  ) {}

  async import(
    candidate: Moment,
    source: LegacyMomentImportSource,
    image: File | null,
  ): Promise<LegacyMomentImportOutcome> {
    let record = await this.moments.findImportRecord(source.sourceId);
    let created = false;

    if (record) {
      this.requireMatchingHash(record, source.sourceHash);
    } else {
      try {
        record = await this.moments.createImported(candidate, source);
        created = true;
      } catch (error) {
        if (!(error instanceof MomentImportConflictError)) throw error;
        record = await this.moments.findImportRecord(source.sourceId);
        if (!record) throw error;
        this.requireMatchingHash(record, source.sourceHash);
      }
    }

    if (!image) {
      return this.outcome(
        record,
        source,
        created ? "created" : "already_imported",
        "not_provided",
      );
    }

    const imageHash = await sha256MomentImage(image);

    if (record.imagePath) {
      return await this.confirmExistingImage(record, source, imageHash);
    }

    const path = this.createImagePath(record.moment.id);
    let candidateAuthorized = false;

    try {
      await this.moments.authorizeImageCandidate(
        record.moment.id,
        record.revision,
        path,
      );
      candidateAuthorized = true;
      await this.images.upload(path, image);
      const saved = await this.moments.updateWithImagePath(
        record.moment,
        path,
        imageHash,
      );
      return {
        outcome: created ? "created" : "completed_existing",
        imageOutcome: "uploaded",
        sourceId: source.sourceId,
        sourceHash: source.sourceHash,
        moment: saved.moment,
      };
    } catch (cause) {
      const cleanupFailures = candidateAuthorized
        ? await this.cleanupCandidate(path)
        : [];
      let latest: StoredImportedMomentRecord | null | undefined;

      try {
        latest = await this.waitForConcurrentImageCompletion(source);
        if (latest?.imagePath) {
          return await this.confirmExistingImage(latest, source, imageHash);
        }
      } catch (error) {
        cleanupFailures.push(error);
      }

      if (cause instanceof MomentVersionConflictError && latest) {
        return this.outcome(
          latest,
          source,
          "image_mismatch",
          "mismatch",
        );
      }

      throw new MomentImportLifecycleError(
        "Legacy Moment image persistence could not complete and remains available for retry.",
        cleanupFailures,
        { cause },
      );
    }
  }

  private async waitForConcurrentImageCompletion(
    source: LegacyMomentImportSource,
  ): Promise<StoredImportedMomentRecord | null> {
    let latest: StoredImportedMomentRecord | null = null;

    for (let attempt = 0; attempt < concurrentImagePollAttempts; attempt += 1) {
      latest = await this.moments.findImportRecord(source.sourceId);
      if (!latest) return null;

      this.requireMatchingHash(latest, source.sourceHash);
      if (latest.imagePath) return latest;

      if (attempt < concurrentImagePollAttempts - 1) {
        await this.pause(concurrentImagePollIntervalMs);
      }
    }

    return latest;
  }

  private requireMatchingHash(
    record: StoredImportedMomentRecord,
    sourceHash: string,
  ) {
    if (record.sourceHash !== sourceHash) {
      throw new LegacyImportSourceConflictError();
    }
  }

  private async confirmExistingImage(
    record: StoredImportedMomentRecord,
    source: LegacyMomentImportSource,
    suppliedImageHash: string,
  ): Promise<LegacyMomentImportOutcome> {
    if (
      !record.imagePath ||
      !isOwnedMomentImagePath(
        record.imagePath,
        this.userId,
        record.moment.id,
      )
    ) {
      throw new MomentImportLifecycleError(
        "The stored imported Moment image reference is invalid.",
      );
    }

    const storedImage = await this.images.download(record.imagePath);
    const storedImageHash = await sha256MomentImage(storedImage.body);

    if (
      record.importImageHash !== suppliedImageHash ||
      storedImageHash !== suppliedImageHash
    ) {
      return this.outcome(record, source, "image_mismatch", "mismatch");
    }

    return this.outcome(
      record,
      source,
      "already_imported",
      "already_present",
    );
  }

  private outcome(
    record: StoredImportedMomentRecord,
    source: LegacyMomentImportSource,
    outcome: LegacyMomentImportOutcome["outcome"],
    imageOutcome: LegacyMomentImportOutcome["imageOutcome"],
  ): LegacyMomentImportOutcome {
    return {
      outcome,
      imageOutcome,
      sourceId: source.sourceId,
      sourceHash: source.sourceHash,
      moment: record.moment,
    };
  }

  private createImagePath(momentId: string): string {
    try {
      return createMomentImagePath(
        this.userId,
        momentId,
        this.createImageGeneration(),
      );
    } catch (cause) {
      throw new MomentImportLifecycleError(
        "The authenticated Moment image path is invalid.",
        [],
        { cause },
      );
    }
  }

  private async cleanupCandidate(path: string): Promise<unknown[]> {
    const failures: unknown[] = [];

    try {
      await this.images.remove(path);
    } catch (error) {
      failures.push(error);
    }

    if (failures.length === 0) {
      try {
        await this.moments.completeImageCleanup(path);
      } catch (error) {
        failures.push(error);
      }
    }

    return failures;
  }
}
