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
  image_path: string | null;
  created_at: string;
  updated_at: string;
};

const momentColumns = [
  "id",
  "owner_id",
  "title",
  "description",
  "mood",
  "moment_date",
  "image_path",
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

  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.owner_id) &&
    isNonEmptyString(candidate.title) &&
    isNonEmptyString(candidate.description) &&
    typeof candidate.mood === "string" &&
    allowedMoods.has(candidate.mood as Moment["mood"]) &&
    typeof candidate.moment_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.moment_date) &&
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

  return {
    id: value.id,
    date: new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(`${value.moment_date}T00:00:00Z`)),
    dateTime: `${value.moment_date}T${createdTime}Z`,
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(createdAt),
    mood: value.mood,
    title: value.title,
    excerpt: value.description,
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
    const { data, error } = await this.client
      .from("moments")
      .select(momentColumns)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throwPersistenceError("load", error);
    }

    return data === null ? null : mapMomentRow(data);
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

  async update(moment: Moment): Promise<Moment> {
    const { data, error } = await this.client
      .from("moments")
      .update({
        title: moment.title,
        description: moment.excerpt,
        mood: moment.mood,
        moment_date: moment.dateTime.slice(0, 10),
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
}
