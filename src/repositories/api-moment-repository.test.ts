import { describe, expect, it, vi } from "vitest";

import type { Moment } from "@/data/moments";

import {
  ApiMomentRepository,
  ApiMomentRepositoryError,
} from "./api-moment-repository";

const savedMoment: Moment = {
  id: "92cd54b1-f61c-49f5-b4f6-f6ab99429741",
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:00Z",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful before the day began.",
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

  it("updates and deletes through the owner-scoped API endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ moment: savedMoment }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const repository = new ApiMomentRepository(fetcher as typeof fetch);

    await expect(repository.update(savedMoment)).resolves.toEqual(savedMoment);
    await expect(repository.delete(savedMoment.id)).resolves.toBeUndefined();

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
        },
        method: "PATCH",
      },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/moments/${savedMoment.id}`,
      {
        headers: { Accept: "application/json" },
        method: "DELETE",
      },
    );
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

  it("does not silently discard an image while cloud image storage is deferred", async () => {
    const fetcher = vi.fn();
    const repository = new ApiMomentRepository(fetcher as typeof fetch);
    const momentWithImage: Moment = {
      ...savedMoment,
      image: {
        src: "data:image/png;base64,aW1hZ2U=",
        alt: "A quiet beginning moment image.",
      },
    };

    await expect(repository.create(momentWithImage)).rejects.toThrow(
      "Moment images are not available in cloud storage yet.",
    );
    await expect(repository.update(momentWithImage)).rejects.toThrow(
      "Moment images are not available in cloud storage yet.",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
