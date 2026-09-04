import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  AccountDataExportError,
  createAccountDataExport,
  type AccountDataExportImage,
  type AccountDataExportRepository,
  type AccountDataExportSourceMoment,
} from "./account-data-export";

const IMAGE_PATH =
  "user_2abc/00000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
]);

const sourceMoment: AccountDataExportSourceMoment = {
  id: "00000000-0000-4000-8000-000000000001",
  revision: 4,
  title: "A quiet morning",
  description: "Rain at the window and nowhere else to be.",
  mood: "calm",
  date: "2026-09-02",
  time: "07:45:00",
  createdAt: "2026-09-02T07:46:00.000Z",
  updatedAt: "2026-09-03T09:10:00.000Z",
  imagePath: IMAGE_PATH,
  legacyImport: {
    source: "legacy-localstorage-v1",
    sourceId: "legacy-1",
    sourceHash: "a".repeat(64),
    imageHash: "b".repeat(64),
  },
};

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

async function readStreamUntilFailure(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes: concatenate(chunks), error: null };
      chunks.push(value);
    }
  } catch (error) {
    return { bytes: concatenate(chunks), error };
  }
}

function concatenate(chunks: readonly Uint8Array[]) {
  const bytes = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function hasFinalZipDirectory(bytes: Uint8Array) {
  return (
    bytes.length >= 22 &&
    bytes[bytes.length - 22] === 0x50 &&
    bytes[bytes.length - 21] === 0x4b &&
    bytes[bytes.length - 20] === 0x05 &&
    bytes[bytes.length - 19] === 0x06
  );
}

function repository(
  moments: AccountDataExportSourceMoment[],
  image = { bytes: PNG_BYTES, contentType: "image/png" },
): AccountDataExportRepository {
  return {
    listMoments: vi.fn().mockResolvedValue(moments),
    downloadImage: vi.fn().mockResolvedValue(image),
  };
}

describe("createAccountDataExport", () => {
  it("creates a versioned archive with complete Moment metadata and original image bytes", async () => {
    const source = repository([sourceMoment]);

    const archive = await createAccountDataExport(source, {
      exportedAt: new Date("2026-09-04T12:34:56.000Z"),
    });
    const files = unzipSync(await readStream(archive.stream));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));

    expect(archive.fileName).toBe("mood-and-moments-export-2026-09-04.zip");
    expect(Object.keys(files).sort()).toEqual([
      "images/00000000-0000-4000-8000-000000000001.png",
      "manifest.json",
    ]);
    expect(
      files["images/00000000-0000-4000-8000-000000000001.png"],
    ).toEqual(PNG_BYTES);
    expect(manifest).toEqual({
      format: "mood-and-moments-export",
      schemaVersion: 1,
      exportedAt: "2026-09-04T12:34:56.000Z",
      moments: [
        {
          id: sourceMoment.id,
          revision: 4,
          title: "A quiet morning",
          description: "Rain at the window and nowhere else to be.",
          mood: "calm",
          date: "2026-09-02",
          time: "07:45:00",
          createdAt: "2026-09-02T07:46:00.000Z",
          updatedAt: "2026-09-03T09:10:00.000Z",
          legacyImport: sourceMoment.legacyImport,
          image: {
            archivePath:
              "images/00000000-0000-4000-8000-000000000001.png",
            contentType: "image/png",
            byteLength: PNG_BYTES.length,
            sha256:
              "b7c23e74a00c13aa5dd34e3ec6f1999483a340aeebc4f054fad4c98bc66d3e35",
          },
        },
      ],
    });
    expect(JSON.stringify(manifest)).not.toContain("user_2abc");
    expect(JSON.stringify(manifest)).not.toContain(IMAGE_PATH);
    expect(source.downloadImage).toHaveBeenCalledWith(IMAGE_PATH);
  });

  it("exports text-only and empty accounts without reading Storage", async () => {
    const textOnly = { ...sourceMoment, imagePath: null, legacyImport: null };
    const source = repository([textOnly]);
    const emptySource = repository([]);

    const textArchive = await createAccountDataExport(source, {
      exportedAt: new Date("2026-09-04T00:00:00.000Z"),
    });
    const textFiles = unzipSync(await readStream(textArchive.stream));
    const textManifest = JSON.parse(strFromU8(textFiles["manifest.json"]));
    const emptyArchive = await createAccountDataExport(emptySource, {
      exportedAt: new Date("2026-09-04T00:00:00.000Z"),
    });
    const emptyFiles = unzipSync(await readStream(emptyArchive.stream));
    const emptyManifest = JSON.parse(strFromU8(emptyFiles["manifest.json"]));

    expect(textManifest.moments[0].image).toBeNull();
    expect(textManifest.moments[0].legacyImport).toBeNull();
    expect(Object.keys(textFiles)).toEqual(["manifest.json"]);
    expect(source.downloadImage).not.toHaveBeenCalled();
    expect(emptyManifest.moments).toEqual([]);
    expect(emptySource.downloadImage).not.toHaveBeenCalled();
  });

  it.each([
    {
      contentType: "image/jpeg",
      extension: "jpg",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01]),
    },
    {
      contentType: "image/webp",
      extension: "webp",
      bytes: new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45,
        0x42, 0x50,
      ]),
    },
  ])(
    "preserves original $contentType bytes using the .$extension archive extension",
    async ({ bytes, contentType, extension }) => {
      const archive = await createAccountDataExport(
        repository([sourceMoment], { bytes, contentType }),
        { exportedAt: new Date("2026-09-04T00:00:00.000Z") },
      );
      const files = unzipSync(await readStream(archive.stream));

      expect(files[`images/${sourceMoment.id}.${extension}`]).toEqual(bytes);
    },
  );

  it.each([
    {
      name: "unsupported MIME type",
      image: { bytes: PNG_BYTES, contentType: "image/gif" },
    },
    {
      name: "empty image",
      image: { bytes: new Uint8Array(), contentType: "image/png" },
    },
    {
      name: "oversized image",
      image: { bytes: new Uint8Array(1_000_001), contentType: "image/png" },
    },
  ])("fails the complete export for an $name", async ({ image }) => {
    const archive = await createAccountDataExport(
      repository([sourceMoment], image),
      { exportedAt: new Date("2026-09-04T00:00:00.000Z") },
    );

    await expect(readStream(archive.stream)).rejects.toBeInstanceOf(
      AccountDataExportError,
    );
  });

  it("fails the complete export when a referenced private image cannot be read", async () => {
    const source = repository([sourceMoment]);
    vi.mocked(source.downloadImage).mockRejectedValueOnce(
      new Error("private provider failure"),
    );

    const archive = await createAccountDataExport(source, {
      exportedAt: new Date("2026-09-04T00:00:00.000Z"),
    });

    await expect(readStream(archive.stream)).rejects.toBeInstanceOf(
      AccountDataExportError,
    );
  });

  it("rejects an unsafe archive identity instead of creating a caller-controlled path", async () => {
    const unsafeMoment = { ...sourceMoment, id: "../../private" };

    await expect(
      createAccountDataExport(repository([unsafeMoment]), {
        exportedAt: new Date("2026-09-04T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(AccountDataExportError);
  });

  it("returns the stream before later images resolve and downloads images sequentially", async () => {
    const secondMoment = {
      ...sourceMoment,
      id: "00000000-0000-4000-8000-000000000002",
      imagePath:
        "user_2abc/00000000-0000-4000-8000-000000000002/22222222-2222-4222-8222-222222222222",
    };
    let resolveSecond: ((image: AccountDataExportImage) => void) | undefined;
    const source: AccountDataExportRepository = {
      listMoments: vi.fn().mockResolvedValue([sourceMoment, secondMoment]),
      downloadImage: vi
        .fn()
        .mockResolvedValueOnce({ bytes: PNG_BYTES, contentType: "image/png" })
        .mockImplementationOnce(
          () =>
            new Promise<AccountDataExportImage>((resolve) => {
              resolveSecond = resolve;
            }),
        ),
    };
    const archivePromise = createAccountDataExport(source, {
      exportedAt: new Date("2026-09-04T00:00:00.000Z"),
    });
    const initialState = await Promise.race([
      archivePromise.then(() => "stream-ready" as const),
      new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 0),
      ),
    ]);

    let archive: Awaited<ReturnType<typeof createAccountDataExport>>;
    if (initialState === "stream-ready") {
      archive = await archivePromise;
      const readPromise = readStream(archive.stream);
      await vi.waitFor(() => expect(resolveSecond).toBeTypeOf("function"));
      resolveSecond?.({ bytes: PNG_BYTES, contentType: "image/png" });
      await expect(readPromise).resolves.toBeInstanceOf(Uint8Array);
    } else {
      resolveSecond?.({ bytes: PNG_BYTES, contentType: "image/png" });
      archive = await archivePromise;
      await expect(readStream(archive.stream)).resolves.toBeInstanceOf(
        Uint8Array,
      );
    }

    expect(initialState).toBe("stream-ready");
    expect(source.downloadImage).toHaveBeenCalledTimes(2);
  });

  it("never finalizes a valid ZIP when a later image fails", async () => {
    const secondMoment = {
      ...sourceMoment,
      id: "00000000-0000-4000-8000-000000000002",
      imagePath:
        "user_2abc/00000000-0000-4000-8000-000000000002/22222222-2222-4222-8222-222222222222",
    };
    const source: AccountDataExportRepository = {
      listMoments: vi.fn().mockResolvedValue([sourceMoment, secondMoment]),
      downloadImage: vi
        .fn()
        .mockResolvedValueOnce({ bytes: PNG_BYTES, contentType: "image/png" })
        .mockRejectedValueOnce(new Error("private provider failure")),
    };
    const archive = await createAccountDataExport(source, {
      exportedAt: new Date("2026-09-04T00:00:00.000Z"),
    });

    const result = await readStreamUntilFailure(archive.stream);

    expect(result.error).toBeInstanceOf(AccountDataExportError);
    expect(hasFinalZipDirectory(result.bytes)).toBe(false);
  });
});
