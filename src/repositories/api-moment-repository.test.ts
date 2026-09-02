import { describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";

import {
  ApiMomentRepository,
  ApiMomentRepositoryError,
} from "./api-moment-repository";

const savedMoment: Moment = {
  id: "92cd54b1-f61c-49f5-b4f6-f6ab99429741",
  revision: 1,
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:00Z",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful before the day began.",
};

const savedMomentWithImage: Moment = {
  ...savedMoment,
  image: {
    src: `/api/moments/${savedMoment.id}/image`,
    alt: "A quiet beginning moment image.",
  },
};

const dataImageMoment: Moment = {
  ...savedMoment,
  image: {
    src: "data:image/png;base64,iVBORw0KGgo=",
    alt: "A quiet beginning moment image.",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createRepository(response: Response) {
  const fetcher = vi.fn().mockResolvedValue(response);

  return {
    fetcher,
    repository: new ApiMomentRepository(fetcher as typeof fetch),
  };
}

describe("ApiMomentRepository", () => {
  it("loads authenticated Moments without using a shared browser cache", async () => {
    const { fetcher, repository } = createRepository(
      jsonResponse({ moments: [savedMoment] }),
    );

    await expect(repository.list()).resolves.toEqual([savedMoment]);
    expect(fetcher).toHaveBeenCalledWith("/api/moments", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  });

  it("creates through the API using only server-accepted editable fields", async () => {
    const { fetcher, repository } = createRepository(
      jsonResponse({ moment: savedMoment }, 201),
    );

    await expect(repository.create(savedMoment)).resolves.toEqual(savedMoment);
    expect(fetcher).toHaveBeenCalledWith("/api/moments", {
      body: JSON.stringify({
        title: savedMoment.title,
        description: savedMoment.excerpt,
        mood: savedMoment.mood,
        date: "2026-08-28",
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });

  it("creates an image Moment with multipart data and no client-owned path", async () => {
    const { fetcher, repository } = createRepository(
      jsonResponse({ moment: savedMomentWithImage }, 201),
    );

    await expect(repository.create(dataImageMoment)).resolves.toEqual(
      savedMomentWithImage,
    );

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/moments");
    expect(init).toEqual(
      expect.objectContaining({
        headers: { Accept: "application/json" },
        method: "POST",
      }),
    );
    expect(init.body).toBeInstanceOf(FormData);
    const formData = init.body as FormData;
    expect(formData.get("title")).toBe(savedMoment.title);
    expect(formData.get("owner_id")).toBeNull();
    expect(formData.get("image_path")).toBeNull();
    expect(formData.get("image")).toEqual(
      expect.objectContaining({ size: 8, type: "image/png" }),
    );
  });

  it("keeps an existing private image while updating editable fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ moment: savedMomentWithImage }));
    const repository = new ApiMomentRepository(fetcher as typeof fetch);

    await expect(repository.update(savedMomentWithImage)).resolves.toEqual(
      savedMomentWithImage,
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/moments/${savedMoment.id}`,
      {
        body: JSON.stringify({
          title: savedMoment.title,
          description: savedMoment.excerpt,
          mood: savedMoment.mood,
          date: "2026-08-28",
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Moment-Revision": "1",
        },
        method: "PATCH",
      },
    );
  });

  it("uses explicit multipart actions for image replacement and removal", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ moment: savedMomentWithImage }))
      .mockResolvedValueOnce(jsonResponse({ moment: savedMoment }));
    const repository = new ApiMomentRepository(fetcher as typeof fetch);

    await repository.update(dataImageMoment);
    await repository.update(savedMoment);

    const replacement = fetcher.mock.calls[0]![1]!.body as FormData;
    expect(replacement).toBeInstanceOf(FormData);
    expect(replacement.get("imageAction")).toBe("replace");
    expect(replacement.get("revision")).toBeNull();
    expect(replacement.get("image")).toEqual(
      expect.objectContaining({ type: "image/png" }),
    );
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({
      Accept: "application/json",
      "X-Moment-Revision": "1",
    });
    const removal = fetcher.mock.calls[1]![1]!.body as FormData;
    expect(removal).toBeInstanceOf(FormData);
    expect(removal.get("imageAction")).toBe("remove");
    expect(removal.get("revision")).toBeNull();
    expect(removal.get("image")).toBeNull();
    expect(fetcher.mock.calls[1]![1]!.headers).toEqual({
      Accept: "application/json",
      "X-Moment-Revision": "1",
    });
  });

  it("deletes through the owner-scoped API endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const repository = new ApiMomentRepository(fetcher as typeof fetch);

    await expect(repository.delete(savedMoment.id, 1)).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/moments/${savedMoment.id}`,
      {
        headers: { Accept: "application/json", "X-Moment-Revision": "1" },
        method: "DELETE",
      },
    );
  });

  it("preserves the server's current Moment in a typed version conflict", async () => {
    const currentMoment = {
      ...savedMoment,
      revision: 2,
      title: "Another tab won",
    };
    const { repository } = createRepository(
      jsonResponse(
        {
          error: {
            code: "MOMENT_VERSION_CONFLICT",
            message: "This Moment changed after you loaded it.",
            currentMoment,
          },
        },
        412,
      ),
    );

    await expect(repository.update(savedMoment)).rejects.toMatchObject({
      name: "MomentConflictError",
      currentMoment,
    });
  });

  it("fails before the network when an update/delete lacks a revision", async () => {
    const fetcher = vi.fn();
    const repository = new ApiMomentRepository(fetcher as typeof fetch);
    const unversioned = { ...savedMoment, revision: undefined };

    await expect(repository.update(unversioned)).rejects.toMatchObject({
      code: "INVALID_REVISION",
    });
    await expect(repository.delete(savedMoment.id)).rejects.toMatchObject({
      code: "INVALID_REVISION",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves structured API errors for the UI boundary", async () => {
    const { repository } = createRepository(
      jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Moment details are invalid.",
            fields: { title: "Give this moment a title." },
          },
        },
        422,
      ),
    );

    await expect(repository.create(savedMoment)).rejects.toEqual(
      expect.objectContaining<ApiMomentRepositoryError>({
        name: "ApiMomentRepositoryError",
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Moment details are invalid.",
        fields: { title: "Give this moment a title." },
      }),
    );
  });

  it("normalizes network failures at the repository boundary", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const repository = new ApiMomentRepository(fetcher as typeof fetch);

    await expect(repository.list()).rejects.toEqual(
      expect.objectContaining<ApiMomentRepositoryError>({
        name: "ApiMomentRepositoryError",
        code: "NETWORK_ERROR",
        message: "The Moment service is temporarily unavailable.",
      }),
    );
  });

  it("fails closed when a successful response has an invalid shape", async () => {
    const { repository } = createRepository(jsonResponse({ moments: [{}] }));

    await expect(repository.list()).rejects.toThrow(
      "Moment service returned an invalid response.",
    );
  });

  it("rejects a non-data, non-proxy image source instead of sending a path", async () => {
    const fetcher = vi.fn();
    const repository = new ApiMomentRepository(fetcher as typeof fetch);
    const momentWithImage: Moment = {
      ...savedMoment,
      image: {
        src: "https://attacker.example/image.png",
        alt: "A quiet beginning moment image.",
      },
    };

    await expect(repository.update(momentWithImage)).rejects.toThrow(
      "Moment image source is not trusted.",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
