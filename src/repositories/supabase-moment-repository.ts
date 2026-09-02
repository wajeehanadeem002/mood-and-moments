import type { SupabaseClient } from "@supabase/supabase-js";

import type { Moment } from "@/data/moments";
import type { MomentRepository } from "@/repositories/moment-repository";
import { MomentConflictError } from "@/repositories/moment-repository";

type MomentRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  mood: Moment["mood"];
  moment_date: string;
  moment_time: string | null;
  image_path: string | null;
  import_source: "legacy-localstorage-v1" | null;
  import_source_id: string | null;
  import_source_hash: string | null;
  import_image_hash: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

export type StoredMomentRecord = {
  moment: Moment;
  revision: number;
  imagePath: string | null;
  importImageHash: string | null;
  importSource: "legacy-localstorage-v1" | null;
};

export type StoredImportedMomentRecord = StoredMomentRecord & {
  sourceId: string;
  sourceHash: string;
};

const momentColumns = [
  "id",
  "owner_id",
  "title",
  "description",
  "mood",
  "moment_date",
  "moment_time",
  "image_path",
  "import_source",
  "import_source_id",
  "import_source_hash",
  "import_image_hash",
  "created_at",
  "updated_at",
  "revision",
].join(",");

const allowedMoods = new Set<Moment["mood"]>([
  "happy",
  "calm",
  "loved",
  "sad",
  "angry",
  "tired",
]);

export class MomentNotFoundError extends Error {
  constructor() {
    super("Moment not found.");
    this.name = "MomentNotFoundError";
  }
}

export class MomentImportConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super("The legacy Moment source already exists.", options);
    this.name = "MomentImportConflictError";
  }
}

export class MomentVersionConflictError extends MomentConflictError {
  constructor(
    currentMoment: Moment,
    public readonly cleanupFailures: readonly unknown[] = [],
  ) {
    super(currentMoment);
    this.name = "MomentVersionConflictError";
  }
}

export class MomentPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MomentPersistenceError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMomentRow(value: unknown): value is MomentRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  const hasNormalImportMetadata =
    candidate.moment_time === null &&
    candidate.import_source === null &&
    candidate.import_source_id === null &&
    candidate.import_source_hash === null &&
    candidate.import_image_hash === null;
  const hasConsistentLegacyImageMetadata =
    (candidate.image_path === null && candidate.import_image_hash === null) ||
    (isNonEmptyString(candidate.image_path) &&
      typeof candidate.import_image_hash === "string" &&
      /^[a-f0-9]{64}$/.test(candidate.import_image_hash));
  const hasLegacyImportMetadata =
    typeof candidate.moment_time === "string" &&
    /^\d{2}:\d{2}:\d{2}$/.test(candidate.moment_time) &&
    candidate.import_source === "legacy-localstorage-v1" &&
    isNonEmptyString(candidate.import_source_id) &&
    typeof candidate.import_source_hash === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.import_source_hash) &&
    hasConsistentLegacyImageMetadata;

  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.owner_id) &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.description) &&
    typeof candidate.mood === "string" &&
    allowedMoods.has(candidate.mood as Moment["mood"]) &&
    typeof candidate.moment_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.moment_date) &&
    (hasNormalImportMetadata || hasLegacyImportMetadata) &&
    (candidate.image_path === null ||
      isNonEmptyString(candidate.image_path)) &&
    isNonEmptyString(candidate.created_at) &&
    !Number.isNaN(new Date(candidate.created_at).valueOf()) &&
    isNonEmptyString(candidate.updated_at) &&
    !Number.isNaN(new Date(candidate.updated_at).valueOf()) &&
    Number.isSafeInteger(candidate.revision) &&
    Number(candidate.revision) >= 1
  );
}

function mapMomentRow(value: unknown): Moment {
  if (!isMomentRow(value)) {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment record.",
    );
  }

  const createdAt = new Date(value.created_at);
  const createdTime = createdAt.toISOString().slice(11, 19);
  const displayTime = value.moment_time ?? createdTime;

  return {
    id: value.id,
    revision: value.revision,
    date: new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(`${value.moment_date}T00:00:00Z`)),
    dateTime: `${value.moment_date}T${displayTime}${value.moment_time ? "" : "Z"}`,
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(`1970-01-01T${displayTime}Z`)),
    mood: value.mood,
    title: value.title,
    excerpt: value.description,
    ...(value.image_path
      ? {
          image: {
            src: `/api/moments/${value.id}/image`,
            alt: `${value.title} moment image.`,
          },
        }
      : {}),
  };
}

function mapStoredMomentRow(value: unknown): StoredMomentRecord {
  if (!isMomentRow(value)) {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment record.",
    );
  }

  return {
    moment: mapMomentRow(value),
    revision: value.revision,
    imagePath: value.image_path,
    importImageHash: value.import_image_hash,
    importSource: value.import_source,
  };
}

function mapImportedMomentRow(value: unknown): StoredImportedMomentRecord {
  if (
    !isMomentRow(value) ||
    value.import_source !== "legacy-localstorage-v1" ||
    value.import_source_id === null ||
    value.import_source_hash === null
  ) {
    throw new MomentPersistenceError(
      "Supabase returned an invalid imported Moment record.",
    );
  }

  return {
    ...mapStoredMomentRow(value),
    sourceId: value.import_source_id,
    sourceHash: value.import_source_hash,
  };
}

function throwPersistenceError(operation: string, cause: unknown): never {
  throw new MomentPersistenceError(
    `Could not ${operation} Moments in Supabase.`,
    { cause },
  );
}

type MutationOutcome =
  | "authorized"
  | "conflict"
  | "deleted"
  | "not_found"
  | "updated";

type MutationResult = {
  outcome: MutationOutcome;
  moment: unknown;
  cleanupPath: string | null;
};

function readMutationResult(value: unknown): MutationResult {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment mutation result.",
    );
  }

  const candidate = value[0];
  if (!candidate || typeof candidate !== "object") {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment mutation result.",
    );
  }

  const result = candidate as Record<string, unknown>;
  const outcome = result.outcome;
  if (
    outcome !== "authorized" &&
    outcome !== "conflict" &&
    outcome !== "deleted" &&
    outcome !== "not_found" &&
    outcome !== "updated"
  ) {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment mutation outcome.",
    );
  }

  const cleanupPath = result.cleanup_path;
  if (cleanupPath !== null && typeof cleanupPath !== "string") {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment cleanup reference.",
    );
  }

  return {
    outcome,
    moment: result.moment,
    cleanupPath,
  };
}

function readCleanupResult(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment cleanup result.",
    );
  }

  const candidate = value[0];
  if (!candidate || typeof candidate !== "object") {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment cleanup result.",
    );
  }

  const outcome = (candidate as Record<string, unknown>).outcome;
  if (typeof outcome !== "string") {
    throw new MomentPersistenceError(
      "Supabase returned an invalid Moment cleanup outcome.",
    );
  }

  return outcome;
}

export class SupabaseMomentRepository implements MomentRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Moment[]> {
    const { data, error } = await this.client
      .from("moments")
      .select(momentColumns)
      .order("moment_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      throwPersistenceError("load", error);
    }

    if (!Array.isArray(data)) {
      throw new MomentPersistenceError(
        "Supabase returned an invalid Moment collection.",
      );
    }

    return data.map(mapMomentRow);
  }

  async findById(id: string): Promise<Moment | null> {
    const record = await this.findRecordById(id);

    return record?.moment ?? null;
  }

  async findRecordById(id: string): Promise<StoredMomentRecord | null> {
    const { data, error } = await this.client
      .from("moments")
      .select(momentColumns)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throwPersistenceError("load", error);
    }

    return data === null ? null : mapStoredMomentRow(data);
  }

  async findImportRecord(
    sourceId: string,
  ): Promise<StoredImportedMomentRecord | null> {
    const { data, error } = await this.client
      .from("moments")
      .select(momentColumns)
      .eq("import_source", "legacy-localstorage-v1")
      .eq("import_source_id", sourceId)
      .maybeSingle();

    if (error) {
      throwPersistenceError("load imported", error);
    }

    return data === null ? null : mapImportedMomentRow(data);
  }

  async create(moment: Moment): Promise<Moment> {
    const { data, error } = await this.client
      .from("moments")
      .insert({
        title: moment.title,
        description: moment.excerpt,
        mood: moment.mood,
        moment_date: moment.dateTime.slice(0, 10),
      })
      .select(momentColumns)
      .single();

    if (error) {
      throwPersistenceError("create", error);
    }

    return mapMomentRow(data);
  }

  async createImported(
    moment: Moment,
    source: { sourceId: string; sourceHash: string; time: string },
  ): Promise<StoredImportedMomentRecord> {
    const { data, error } = await this.client
      .from("moments")
      .insert({
        title: moment.title,
        description: moment.excerpt,
        mood: moment.mood,
        moment_date: moment.dateTime.slice(0, 10),
        moment_time: source.time,
        import_source: "legacy-localstorage-v1",
        import_source_id: source.sourceId,
        import_source_hash: source.sourceHash,
      })
      .select(momentColumns)
      .single();

    if (error?.code === "23505") {
      throw new MomentImportConflictError({ cause: error });
    }
    if (error) {
      throwPersistenceError("import", error);
    }

    return mapImportedMomentRow(data);
  }

  async update(moment: Moment): Promise<Moment> {
    if (!moment.image) {
      return (await this.updateRow(moment, null, null)).moment;
    }

    const record = await this.findRecordById(moment.id);
    if (!record) throw new MomentNotFoundError();

    return (
      await this.updateRow(
        moment,
        record.imagePath,
        record.importImageHash,
      )
    ).moment;
  }

  async updateWithImagePath(
    moment: Moment,
    imagePath: string | null,
    importImageHash: string | null,
  ): Promise<{ moment: Moment; cleanupPath: string | null }> {
    return this.updateRow(moment, imagePath, importImageHash);
  }

  private async updateRow(
    moment: Moment,
    imagePath?: string | null,
    importImageHash?: string | null,
  ): Promise<{ moment: Moment; cleanupPath: string | null }> {
    const revision = moment.revision;

    if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
      throw new MomentPersistenceError(
        "A current Moment revision is required for update.",
      );
    }

    if (imagePath === undefined) {
      throw new MomentPersistenceError(
        "The current Moment image reference is required for update.",
      );
    }

    const { data, error } = await this.client.rpc(
      "update_moment_if_revision",
      {
        requested_moment_id: moment.id,
        requested_revision: revision,
        requested_title: moment.title,
        requested_description: moment.excerpt,
        requested_mood: moment.mood,
        requested_moment_date: moment.dateTime.slice(0, 10),
        requested_image_path: imagePath,
        requested_import_image_hash: importImageHash ?? null,
      },
    );

    if (error) {
      throwPersistenceError("update", error);
    }

    const result = readMutationResult(data);

    if (result.outcome === "not_found") {
      throw new MomentNotFoundError();
    }

    if (result.outcome === "conflict") {
      throw new MomentVersionConflictError(mapMomentRow(result.moment));
    }

    if (result.outcome !== "updated") {
      throw new MomentPersistenceError(
        "Supabase returned an invalid Moment update outcome.",
      );
    }

    return {
      moment: mapMomentRow(result.moment),
      cleanupPath: result.cleanupPath,
    };
  }

  async delete(id: string, revision?: number): Promise<void> {
    await this.deleteRecord(id, revision);
  }

  async deleteRecord(
    id: string,
    revision?: number,
  ): Promise<{ cleanupPath: string | null }> {
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
      throw new MomentPersistenceError(
        "A current Moment revision is required for delete.",
      );
    }

    const { data, error } = await this.client.rpc(
      "delete_moment_if_revision",
      {
        requested_moment_id: id,
        requested_revision: revision,
      },
    );

    if (error) {
      throwPersistenceError("delete", error);
    }

    const result = readMutationResult(data);

    if (result.outcome === "not_found") {
      throw new MomentNotFoundError();
    }

    if (result.outcome === "conflict") {
      throw new MomentVersionConflictError(mapMomentRow(result.moment));
    }

    if (result.outcome !== "deleted") {
      throw new MomentPersistenceError(
        "Supabase returned an invalid Moment delete outcome.",
      );
    }

    return { cleanupPath: result.cleanupPath };
  }

  async authorizeImageCandidate(
    id: string,
    revision: number,
    imagePath: string,
  ): Promise<void> {
    const { data, error } = await this.client.rpc(
      "authorize_moment_image_candidate",
      {
        requested_moment_id: id,
        requested_revision: revision,
        requested_image_path: imagePath,
      },
    );

    if (error) throwPersistenceError("authorize", error);
    const result = readMutationResult(data);
    if (result.outcome === "not_found") throw new MomentNotFoundError();
    if (result.outcome === "conflict") {
      throw new MomentVersionConflictError(mapMomentRow(result.moment));
    }
    if (result.outcome !== "authorized") {
      throw new MomentPersistenceError(
        "Supabase returned an invalid Moment image authorization outcome.",
      );
    }
  }

  async completeImageCleanup(imagePath: string): Promise<void> {
    const { data, error } = await this.client.rpc(
      "complete_moment_image_cleanup",
      { requested_image_path: imagePath },
    );

    if (error) throwPersistenceError("complete image cleanup for", error);
    const result = readCleanupResult(data);
    if (result !== "completed" && result !== "not_found") {
      throw new MomentPersistenceError(
        "The Moment image cleanup authorization cannot be completed while its object exists.",
      );
    }
  }

}
