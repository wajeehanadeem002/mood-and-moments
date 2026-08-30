import type { Moment } from "@/data/moments";
import type { SupabaseMomentImageRepository } from "@/repositories/supabase-moment-image-repository";
import {
  MomentImportConflictError,
  type StoredImportedMomentRecord,
  type SupabaseMomentRepository,
} from "@/repositories/supabase-moment-repository";

type ImportMomentStore = Pick<
  SupabaseMomentRepository,
  | "createImported"
  | "deleteIncompleteImport"
  | "findImportRecord"
  | "updateWithImagePath"
>;

type ImportImageStore = Pick<SupabaseMomentImageRepository, "remove" | "upsert">;

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
  outcome: "created" | "already_imported" | "completed_existing";
  imageOutcome: "uploaded" | "already_present" | "not_provided";
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

function stableImagePath(userId: string, momentId: string) {
  if (!userId || userId.includes("/")) {
    throw new MomentImportLifecycleError(
      "The authenticated user identity cannot be used for image storage.",
    );
  }
  return `${userId}/${momentId}/image`;
}

export class AuthenticatedMomentImportService {
  constructor(
    private readonly moments: ImportMomentStore,
    private readonly images: ImportImageStore,
    private readonly userId: string,
    private readonly pause: Pause = defaultPause,
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

    if (record.imagePath) {
      return this.outcome(
        record,
        source,
        "already_imported",
        "already_present",
      );
    }

    const path = stableImagePath(this.userId, record.moment.id);
    try {
      await this.images.upsert(path, image);
      const saved = await this.moments.updateWithImagePath(record.moment, path);
      return {
        outcome: created ? "created" : "completed_existing",
        imageOutcome: "uploaded",
        sourceId: source.sourceId,
        sourceHash: source.sourceHash,
        moment: saved,
      };
    } catch (cause) {
      const cleanupFailures: unknown[] = [];
      let rowRemoved = false;
      let latest: StoredImportedMomentRecord | null | undefined;

      try {
        latest = await this.waitForConcurrentImageCompletion(source);
        if (latest?.imagePath) {
          return this.outcome(
            latest,
            source,
            "already_imported",
            "already_present",
          );
        }
      } catch (error) {
        cleanupFailures.push(error);
      }

      if (created) {
        try {
          rowRemoved = await this.moments.deleteIncompleteImport(
            record.moment.id,
          );
        } catch (error) {
          cleanupFailures.push(error);
        }
      }

      if (rowRemoved || latest === null) {
        try {
          await this.images.remove(path);
        } catch (error) {
          cleanupFailures.push(error);
        }
      }

      throw new MomentImportLifecycleError(
        "Legacy Moment image persistence could not complete and was rolled back.",
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
}
