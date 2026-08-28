import { describe, expect, it } from "vitest";

import {
  createMomentConfirmation,
  validateMomentText,
} from "./mood-ritual";

describe("mood ritual behavior", () => {
  it("rejects a moment containing only whitespace", () => {
    expect(validateMomentText("   ")).toBe(
      "Write a few words about the moment you want to remember.",
    );
  });

  it("accepts a meaningful moment", () => {
    expect(validateMomentText("Coffee by the window")).toBeNull();
  });

  it("confirms the selected mood without claiming persistence", () => {
    expect(createMomentConfirmation("Calm")).toBe(
      "Your Calm moment is ready in this preview.",
    );
  });
});
