import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountDataExportImage,
  AccountDataExportRepository,
  AccountDataExportSourceMoment,
} from "@/lib/account-data-export";
import { SupabaseMomentImageRepository } from "@/repositories/supabase-moment-image-repository";

type ImageReader = Pick<SupabaseMomentImageRepository, "download">;

const exportColumns = [
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

const allowedMoods = new Set([
  "happy",
  "calm",
  "loved",
  "sad",
  "angry",
  "tired",
]);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const exportPageSize = 500;

export class AccountExportPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccountExportPersistenceError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidTimestamp(value: unknown): value is string {
  return (
    isNonEmptyString(value) && !Number.isNaN(new Date(value).valueOf())
  );
}

function isValidImagePath(
  value: unknown,
  ownerId: string,
  momentId: string,
): value is string | null {
  if (value === null) return true;
  if (!isNonEmptyString(value)) return false;

  const segments = value.split("/");
  return (
    segments.length === 3 &&
    segments[0] === ownerId &&
    segments[1] === momentId &&
    (segments[2] === "image" || uuidPattern.test(segments[2] ?? ""))
  );
}

function mapExportRow(value: unknown): AccountDataExportSourceMoment {
  if (!value || typeof value !== "object") {
    throw new AccountExportPersistenceError(
      "Supabase returned an invalid account export record.",
    );
  }

  const row = value as Record<string, unknown>;
  const hasBaseFields =
    typeof row.id === "string" &&
    uuidPattern.test(row.id) &&
    isNonEmptyString(row.owner_id) &&
    isNonEmptyString(row.title) &&
    isNonEmptyString(row.description) &&
    typeof row.mood === "string" &&
    allowedMoods.has(row.mood) &&
    typeof row.moment_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.moment_date) &&
    isValidImagePath(row.image_path, row.owner_id, row.id) &&
    isValidTimestamp(row.created_at) &&
    isValidTimestamp(row.updated_at) &&
    Number.isSafeInteger(row.revision) &&
    Number(row.revision) >= 1;

  const isOrdinary =
    row.moment_time === null &&
    row.import_source === null &&
    row.import_source_id === null &&
    row.import_source_hash === null &&
    row.import_image_hash === null;
  const hasLegacyImageMetadata =
    (row.image_path === null && row.import_image_hash === null) ||
    (row.image_path !== null &&
      typeof row.import_image_hash === "string" &&
      sha256Pattern.test(row.import_image_hash));
  const isLegacy =
    typeof row.moment_time === "string" &&
    /^\d{2}:\d{2}:\d{2}$/.test(row.moment_time) &&
    row.import_source === "legacy-localstorage-v1" &&
    isNonEmptyString(row.import_source_id) &&
    typeof row.import_source_hash === "string" &&
    sha256Pattern.test(row.import_source_hash) &&
    hasLegacyImageMetadata;

  if (!hasBaseFields || (!isOrdinary && !isLegacy)) {
    throw new AccountExportPersistenceError(
      "Supabase returned an invalid account export record.",
    );
  }

  return {
    id: row.id as string,
    revision: row.revision as number,
    title: row.title as string,
    description: row.description as string,
    mood: row.mood as AccountDataExportSourceMoment["mood"],
    date: row.moment_date as string,
    time: row.moment_time as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    imagePath: row.image_path as string | null,
    legacyImport: isLegacy
      ? {
          source: "legacy-localstorage-v1",
          sourceId: row.import_source_id as string,
          sourceHash: row.import_source_hash as string,
          imageHash: row.import_image_hash as string | null,
        }
      : null,
  };
}

export class SupabaseAccountExportRepository
  implements AccountDataExportRepository
{
  private readonly imageRepository: ImageReader;

  constructor(
    private readonly client: SupabaseClient,
    imageRepository?: ImageReader,
  ) {
    this.imageRepository =
      imageRepository ?? new SupabaseMomentImageRepository(client);
  }

  async listMoments(): Promise<AccountDataExportSourceMoment[]> {
    const moments: AccountDataExportSourceMoment[] = [];
    const momentIds = new Set<string>();
    let expectedCount: number | null = null;

    for (let offset = 0; ; offset += exportPageSize) {
      const { count, data, error } = await this.client
        .from("moments")
        .select(exportColumns, { count: "exact" })
        .order("moment_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + exportPageSize - 1);

      if (error) {
        throw new AccountExportPersistenceError(
          "Could not load account export data from Supabase.",
          { cause: error },
        );
      }

      if (
        !Array.isArray(data) ||
        !Number.isSafeInteger(count) ||
        Number(count) < 0
      ) {
        throw new AccountExportPersistenceError(
          "Supabase returned an invalid account export collection.",
        );
      }

      if (expectedCount === null) expectedCount = Number(count);
      if (count !== expectedCount) {
        throw new AccountExportPersistenceError(
          "Account export data changed while it was being read.",
        );
      }

      for (const value of data) {
        const moment = mapExportRow(value);
        if (momentIds.has(moment.id)) {
          throw new AccountExportPersistenceError(
            "Supabase returned a duplicate account export record.",
          );
        }
        momentIds.add(moment.id);
        moments.push(moment);
      }

      if (moments.length === expectedCount) return moments;
      if (
        moments.length > expectedCount ||
        data.length !== exportPageSize
      ) {
        throw new AccountExportPersistenceError(
          "Supabase returned an incomplete account export collection.",
        );
      }
    }
  }

  async downloadImage(path: string): Promise<AccountDataExportImage> {
    const image = await this.imageRepository.download(path);

    return {
      bytes: new Uint8Array(await image.body.arrayBuffer()),
      contentType: image.contentType,
    };
  }
}
