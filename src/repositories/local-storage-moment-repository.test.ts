import { beforeEach, describe, expect, it } from "vitest";

import type { Moment } from "@/data/moments";

import {
  LocalStorageMomentRepository,
  MOMENTS_STORAGE_KEY,
} from "./local-storage-moment-repository";

const savedMoment: Moment = {
  id: "moment-1",
  date: "Aug 28, 2026",
  dateTime: "2026-08-28T09:15:00",
  time: "9:15 AM",
  mood: "calm",
  title: "A quiet beginning",
  excerpt: "The room felt peaceful before the day began.",
};

describe("LocalStorageMomentRepository", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns a Moment after storing it", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);

    await repository.create(savedMoment);

    expect(await repository.list()).toEqual([savedMoment]);
  });

  it("preserves every Moment when creates start concurrently", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);
    const laterMoment: Moment = {
      ...savedMoment,
      id: "moment-2",
      title: "A second quiet beginning",
    };

    await Promise.all([
      repository.create(savedMoment),
      repository.create(laterMoment),
    ]);

    expect(await repository.list()).toEqual([laterMoment, savedMoment]);
  });

  it("recovers from malformed JSON without exposing a load failure", async () => {
    window.localStorage.setItem(MOMENTS_STORAGE_KEY, "{not-json");
    const repository = new LocalStorageMomentRepository(window.localStorage);

    expect(await repository.list()).toEqual([]);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBeNull();
  });

  it("discards stored data that does not match the Moment schema", async () => {
    window.localStorage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify([{ title: "Missing required fields" }]),
    );
    const repository = new LocalStorageMomentRepository(window.localStorage);

    expect(await repository.list()).toEqual([]);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBeNull();
  });

  it("discards a stored Moment with an unsafe image source", async () => {
    window.localStorage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify([
        {
          ...savedMoment,
          image: {
            src: "javascript:alert('unsafe')",
            alt: "Unsafe image",
          },
        },
      ]),
    );
    const repository = new LocalStorageMomentRepository(window.localStorage);

    expect(await repository.list()).toEqual([]);
    expect(window.localStorage.getItem(MOMENTS_STORAGE_KEY)).toBeNull();
  });
});
