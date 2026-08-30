import { describe, expect, it } from "vitest";

import { parseLegacyMomentImportFormData } from "./legacy-moment-import-request";

function validForm() {
  const form = new FormData();
  form.set("sourceId", "legacy-1");
  form.set("title", "A quiet beginning");
  form.set("description", "The room felt peaceful.");
  form.set("mood", "calm");
  form.set("date", "2026-08-28");
  form.set("time", "09:15:30");
  return form;
}

describe("parseLegacyMomentImportFormData", () => {
  it("accepts one normalized text-only legacy import", async () => {
    await expect(parseLegacyMomentImportFormData(validForm())).resolves.toEqual({
      success: true,
      data: {
        image: null,
        input: {
          title: "A quiet beginning",
          description: "The room felt peaceful.",
          mood: "calm",
          date: "2026-08-28",
        },
        sourceId: "legacy-1",
        time: "09:15:30",
      },
    });
  });

  it("rejects ownership, cloud ids, paths, and duplicate fields", async () => {
    for (const field of ["ownerId", "id", "imagePath"]) {
      const form = validForm();
      form.set(field, "caller-controlled");
      await expect(parseLegacyMomentImportFormData(form)).resolves.toEqual({
        success: false,
        errors: { request: "Request body contains unsupported or duplicate fields." },
      });
    }

    const duplicate = validForm();
    duplicate.append("sourceId", "legacy-2");
    await expect(parseLegacyMomentImportFormData(duplicate)).resolves.toEqual({
      success: false,
      errors: { request: "Request body contains unsupported or duplicate fields." },
    });
  });

  it.each([
    ["", "Choose a valid legacy source id."],
    ["x".repeat(256), "Choose a valid legacy source id."],
  ])("rejects invalid source id %j", async (sourceId, message) => {
    const form = validForm();
    form.set("sourceId", sourceId);
    const result = await parseLegacyMomentImportFormData(form);
    expect(result).toEqual({ success: false, errors: { sourceId: message } });
  });

  it.each(["9:15:30", "24:00:00", "09:60:00", "09:15"])(
    "rejects invalid normalized time %s",
    async (time) => {
      const form = validForm();
      form.set("time", time);
      const result = await parseLegacyMomentImportFormData(form);
      expect(result).toEqual({
        success: false,
        errors: { time: "Choose a valid legacy Moment time." },
      });
    },
  );

  it("repeats signature validation for uploaded images", async () => {
    const form = validForm();
    form.set("image", new File(["image"], "legacy.png", { type: "image/png" }));

    await expect(parseLegacyMomentImportFormData(form)).resolves.toEqual({
      success: false,
      errors: { image: "The image contents do not match its file type." },
    });
  });
});
