import type { SupabaseClient } from "@supabase/supabase-js";

import type { Moment } from "@/data/moments";
import type { MomentRepository } from "@/repositories/moment-repository";

type MomentRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  mood: Moment["mood"];
  moment_date: string;
  moment_time: string | null;
  image_path: string | null;
  import_source: string | null;
  import_source_id: string | null;
  import_source_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredMomentRecord = {
  moment: Moment;
  imagePath: string | null;
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
  "created_at",
  "updated_at",
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
    candidate.import_source_hash === null;
  const hasLegacyImportMetadata =
    typeof candidate.moment_time === "string" &&
    /^\d{2}:\d{2}:\d{2}$/.test(candidate.moment_time) &&
    candidate.import_source === "legacy-localstorage-v1" &&
    isNonEmptyString(candidate.import_source_id) &&
    typeof candidate.import_source_hash === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.import_source_hash);

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
    !Number.isNaN(new Date(candidate.updated_at).valueOf())
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

  return { moment: mapMomentRow(value), imagePath: value.image_path };
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
    return this.updateRow(moment);
  }

  async updateWithImagePath(
    moment: Moment,
    imagePath: string | null,
  ): Promise<Moment> {
    return this.updateRow(moment, imagePath);
  }

  private async updateRow(
    moment: Moment,
    imagePath?: string | null,
  ): Promise<Moment> {
    const { data, error } = await this.client
      .from("moments")
      .update({
        title: moment.title,
        description: moment.excerpt,
        mood: moment.mood,
        moment_date: moment.dateTime.slice(0, 10),
        ...(imagePath !== undefined ? { image_path: imagePath } : {}),
      })
      .eq("id", moment.id)
      .select(momentColumns)
      .maybeSingle();

    if (error) {
      throwPersistenceError("update", error);
    }

    if (data === null) {
      throw new MomentNotFoundError();
    }

    return mapMomentRow(data);
  }

  async delete(id: string): Promise<void> {
    const { data, error } = await this.client
      .from("moments")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      throwPersistenceError("delete", error);
    }

    if (data === null) {
      throw new MomentNotFoundError();
    }
  }

  async deleteIncompleteImport(id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("moments")
      .delete()
      .eq("id", id)
      .eq("import_source", "legacy-localstorage-v1")
      .is("image_path", null)
      .select("id")
      .maybeSingle();

    if (error) {
      throwPersistenceError("roll back imported", error);
    }

    return data !== null;
  }
}
