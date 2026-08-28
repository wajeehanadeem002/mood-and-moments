import { beforeEach, describe, expect, it } from "vitest";

import { LocalStorageMomentRepository } from "@/repositories/local-storage-moment-repository";
import type { MomentDraft } from "./moment-creation";
import {
  createMoment,
  validateMomentDraft,
  validateMomentImage,
} from "./moment-creation";

function createDraft(overrides: Partial<MomentDraft> = {}): MomentDraft {
  return {
    title: "A quiet morning",
    description: "Sunlight moved slowly across the room.",
    mood: "calm",
    date: "2026-08-28",
    image: null,
    ...overrides,
  };
}

describe("Moment creation validation", () => {
  it("reports accessible field errors for required values", () => {
    expect(
      validateMomentDraft(
        createDraft({ title: "  ", description: "", date: "" }),
      ),
    ).toEqual({
      title: "Give this moment a title.",
      description: "Describe the moment you want to remember.",
      date: "Choose the date of this moment.",
    });
  });

  it("rejects text beyond the form limits", () => {
    expect(
      validateMomentDraft(
        createDraft({
          title: "t".repeat(81),
          description: "d".repeat(281),
        }),
      ),
    ).toEqual({
      title: "Keep the title to 80 characters or fewer.",
      description: "Keep the description to 280 characters or fewer.",
    });
  });

  it("accepts a complete text-only Moment", () => {
    expect(validateMomentDraft(createDraft())).toEqual({});
  });

  it("rejects image formats that cannot be stored safely", () => {
    const image = new File(["image"], "memory.gif", { type: "image/gif" });

    expect(validateMomentImage(image)).toBe(
      "Choose a JPEG, PNG, or WebP image.",
    );
  });

  it("rejects images larger than 1 MB", () => {
    const image = new File([new Uint8Array(1_000_001)], "memory.jpg", {
      type: "image/jpeg",
    });

    expect(validateMomentImage(image)).toBe(
      "Choose an image that is 1 MB or smaller.",
    );
  });

  it("accepts a supported image within the size limit", () => {
    const image = new File(["image"], "memory.webp", {
      type: "image/webp",
    });

    expect(validateMomentImage(image)).toBeNull();
  });
});

describe("createMoment", () => {
  beforeEach(() => window.localStorage.clear());

  it("creates a display-ready Moment through the repository", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);
    const image = new File(["image"], "window-light.png", {
      type: "image/png",
    });

    const createdMoment = await createMoment(
      repository,
      createDraft({
        title: "  A quiet morning  ",
        description: "  Sunlight moved slowly across the room.  ",
        image,
      }),
      {
        id: "created-moment",
        now: new Date(2026, 7, 28, 9, 15, 0),
      },
    );

    expect(createdMoment).toEqual({
      id: "created-moment",
      date: "Aug 28, 2026",
      dateTime: "2026-08-28T09:15:00",
      time: "9:15 AM",
      mood: "calm",
      title: "A quiet morning",
      excerpt: "Sunlight moved slowly across the room.",
      image: {
        src: expect.stringMatching(/^data:image\/png;base64,/),
        alt: "A quiet morning moment image.",
      },
    });
    expect(await repository.list()).toEqual([createdMoment]);
  });

  it("does not persist a draft that bypasses form validation", async () => {
    const repository = new LocalStorageMomentRepository(window.localStorage);

    await expect(
      createMoment(repository, createDraft({ title: "  " })),
    ).rejects.toThrow("Moment draft is invalid.");
    expect(await repository.list()).toEqual([]);
  });
});
