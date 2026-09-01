import type { SupabaseClient } from "@supabase/supabase-js";

import { supportedMomentImageTypes } from "@/lib/moment-image-validation";

const MOMENT_IMAGES_BUCKET = "moment-images";
const supportedTypes = new Set<string>(supportedMomentImageTypes);

export type StoredMomentImage = {
  body: Blob;
  contentType: string;
};

export class MomentImagePersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MomentImagePersistenceError";
  }
}

function persistenceError(operation: string, cause: unknown): never {
  throw new MomentImagePersistenceError(
    `Could not ${operation} the Moment image in Supabase Storage.`,
    { cause },
  );
}

export class SupabaseMomentImageRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upload(
    path: string,
    body: Blob,
    contentType = body.type,
  ): Promise<void> {
    const { error } = await this.client.storage
      .from(MOMENT_IMAGES_BUCKET)
      .upload(path, body, {
        cacheControl: "3600",
        contentType,
        upsert: false,
      });

    if (error) {
      persistenceError("upload", error);
    }
  }

  async upsert(
    path: string,
    body: Blob,
    contentType = body.type,
  ): Promise<void> {
    const { error } = await this.client.storage
      .from(MOMENT_IMAGES_BUCKET)
      .upload(path, body, {
        cacheControl: "3600",
        contentType,
        upsert: true,
      });

    if (error) {
      persistenceError("upsert", error);
    }
  }

  async replace(
    path: string,
    body: Blob,
    contentType = body.type,
  ): Promise<void> {
    const { error } = await this.client.storage
      .from(MOMENT_IMAGES_BUCKET)
      .update(path, body, {
        cacheControl: "3600",
        contentType,
        upsert: false,
      });

    if (error) {
      persistenceError("replace", error);
    }
  }

  async restore(path: string, image: StoredMomentImage): Promise<void> {
    const { error } = await this.client.storage
      .from(MOMENT_IMAGES_BUCKET)
      .upload(path, image.body, {
        cacheControl: "3600",
        contentType: image.contentType,
        upsert: true,
      });

    if (error) {
      persistenceError("restore", error);
    }
  }

  async download(path: string): Promise<StoredMomentImage> {
    const { data, error } = await this.client.storage
      .from(MOMENT_IMAGES_BUCKET)
      .download(
        path,
        { cacheNonce: crypto.randomUUID() },
        { cache: "no-store" },
      );

    if (error || !data) {
      persistenceError("download", error);
    }

    if (!supportedTypes.has(data.type)) {
      throw new MomentImagePersistenceError(
        "Supabase Storage returned an unsupported Moment image type.",
      );
    }

    return { body: data, contentType: data.type };
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage
      .from(MOMENT_IMAGES_BUCKET)
      .remove([path]);

    if (error) {
      persistenceError("remove", error);
    }
  }
}
