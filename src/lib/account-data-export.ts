import { strToU8, Zip, ZipPassThrough } from "fflate";

import {
  MAX_MOMENT_IMAGE_BYTES,
  supportedMomentImageTypes,
  validateMomentImageFile,
  type SupportedMomentImageType,
} from "@/lib/moment-image-validation";
import type { MoodId } from "@/data/moments";

export type AccountDataExportLegacyImport = {
  source: string;
  sourceId: string;
  sourceHash: string;
  imageHash: string | null;
};

export type AccountDataExportSourceMoment = {
  id: string;
  revision: number;
  title: string;
  description: string;
  mood: MoodId;
  date: string;
  time: string | null;
  createdAt: string;
  updatedAt: string;
  imagePath: string | null;
  legacyImport: AccountDataExportLegacyImport | null;
};

export type AccountDataExportImage = {
  bytes: Uint8Array;
  contentType: string;
};

export interface AccountDataExportRepository {
  listMoments(): Promise<AccountDataExportSourceMoment[]>;
  downloadImage(path: string): Promise<AccountDataExportImage>;
}

export class AccountDataExportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccountDataExportError";
  }
}

type PreparedImage = {
  archivePath: string;
  bytes: Uint8Array;
  contentType: SupportedMomentImageType;
  sha256: string;
};

const imageExtensions: Record<SupportedMomentImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const supportedTypes = new Set<string>(supportedMomentImageTypes);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSupportedImageType(
  contentType: string,
): contentType is SupportedMomentImageType {
  return supportedTypes.has(contentType);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function prepareImage(
  moment: AccountDataExportSourceMoment,
  repository: AccountDataExportRepository,
): Promise<PreparedImage | null> {
  if (!moment.imagePath) return null;

  let image: AccountDataExportImage;
  try {
    image = await repository.downloadImage(moment.imagePath);
  } catch (cause) {
    throw new AccountDataExportError(
      "A private Moment image could not be read for export.",
      { cause },
    );
  }

  if (!isSupportedImageType(image.contentType)) {
    throw new AccountDataExportError(
      "A private Moment image has an unsupported media type.",
    );
  }

  if (
    image.bytes.byteLength === 0 ||
    image.bytes.byteLength > MAX_MOMENT_IMAGE_BYTES
  ) {
    throw new AccountDataExportError(
      "A private Moment image has an invalid byte length.",
    );
  }

  const file = new File([Uint8Array.from(image.bytes).buffer], "image", {
    type: image.contentType,
  });
  const validation = await validateMomentImageFile(file);
  if (!validation.success) {
    throw new AccountDataExportError(
      "A private Moment image failed integrity validation.",
    );
  }

  return {
    archivePath: `images/${moment.id}.${imageExtensions[image.contentType]}`,
    bytes: image.bytes,
    contentType: image.contentType,
    sha256: await sha256(image.bytes),
  };
}

function addZipEntry(zip: Zip, path: string, bytes: Uint8Array) {
  const entry = new ZipPassThrough(path);
  zip.add(entry);
  entry.push(bytes, true);
}

function createZipStream(
  moments: readonly AccountDataExportSourceMoment[],
  repository: AccountDataExportRepository,
  exportedAt: Date,
) {
  const output = new TransformStream<Uint8Array, Uint8Array>();
  const writer = output.writable.getWriter();
  let queuedWrites = Promise.resolve();
  let zipFailure: unknown = null;
  const zip = new Zip((error, chunk) => {
    if (error) {
      zipFailure = error;
      return;
    }

    queuedWrites = queuedWrites.then(() => writer.write(chunk));
  });

  async function flushWrites() {
    await queuedWrites;
    if (zipFailure) throw zipFailure;
  }

  void (async () => {
    try {
      const manifestMoments = [];

      for (const moment of moments) {
        const image = await prepareImage(moment, repository);
        if (image) {
          addZipEntry(zip, image.archivePath, image.bytes);
          await flushWrites();
        }

        manifestMoments.push({
          id: moment.id,
          revision: moment.revision,
          title: moment.title,
          description: moment.description,
          mood: moment.mood,
          date: moment.date,
          time: moment.time,
          createdAt: moment.createdAt,
          updatedAt: moment.updatedAt,
          legacyImport: moment.legacyImport,
          image: image
            ? {
                archivePath: image.archivePath,
                contentType: image.contentType,
                byteLength: image.bytes.byteLength,
                sha256: image.sha256,
              }
            : null,
        });
      }

      addZipEntry(
        zip,
        "manifest.json",
        strToU8(
          `${JSON.stringify(
            {
              format: "mood-and-moments-export",
              schemaVersion: 1,
              exportedAt: exportedAt.toISOString(),
              moments: manifestMoments,
            },
            null,
            2,
          )}\n`,
        ),
      );
      zip.end();
      await flushWrites();
      await writer.close();
    } catch (error) {
      zip.terminate();
      await writer.abort(error).catch(() => undefined);
    }
  })();

  return output.readable;
}

export async function createAccountDataExport(
  repository: AccountDataExportRepository,
  options: { exportedAt?: Date } = {},
): Promise<{ fileName: string; stream: ReadableStream<Uint8Array> }> {
  const exportedAt = options.exportedAt ?? new Date();
  let moments: AccountDataExportSourceMoment[];

  try {
    moments = await repository.listMoments();
  } catch (cause) {
    throw new AccountDataExportError(
      "Moment data could not be read for export.",
      { cause },
    );
  }

  for (const moment of moments) {
    if (!uuidPattern.test(moment.id)) {
      throw new AccountDataExportError(
        "A Moment has an invalid archive identity.",
      );
    }
  }

  return {
    fileName: `mood-and-moments-export-${exportedAt.toISOString().slice(0, 10)}.zip`,
    stream: createZipStream(moments, repository, exportedAt),
  };
}
