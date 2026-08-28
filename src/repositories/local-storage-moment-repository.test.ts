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

  it("updates one stored Moment without changing the others", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);
    const otherMoment: Moment = {
      ...savedMoment,
      id: "moment-2",
      title: "Another memory",
    };
    const updatedMoment: Moment = {
      ...savedMoment,
      mood: "loved",
      title: "A newly remembered beginning",
    };
    await repository.create(savedMoment);
    await repository.create(otherMoment);

    const result = await repository.update(updatedMoment);

    expect(result).toEqual(updatedMoment);
    expect(await repository.list()).toEqual([otherMoment, updatedMoment]);
  });

  it("rejects an update for a Moment that is not stored", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);

    await expect(repository.update(savedMoment)).rejects.toThrow(
      "Moment not found.",
    );
    expect(await repository.list()).toEqual([]);
  });

  it("deletes one stored Moment without changing the others", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);
    const otherMoment: Moment = {
      ...savedMoment,
      id: "moment-2",
      title: "Another memory",
    };
    await repository.create(savedMoment);
    await repository.create(otherMoment);

    await repository.delete(savedMoment.id);

    expect(await repository.list()).toEqual([otherMoment]);
  });

  it("rejects a delete for a Moment that is not stored", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);

    await expect(repository.delete(savedMoment.id)).rejects.toThrow(
      "Moment not found.",
    );
    expect(await repository.list()).toEqual([]);
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

  it("treats duplicate stored Moment identifiers as corrupted data", async () => {
    window.localStorage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify([
        savedMoment,
        { ...savedMoment, title: "A duplicate identifier" },
      ]),
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
