import { describe, expect, it } from "vitest";

import {
  createMomentImagePath,
  isOwnedMomentImagePath,
} from "./moment-image-path";

const ownerId = "user_clerk_a";
const momentId = "00000000-0000-4000-8000-000000000001";
const generationId = "70000000-0000-4000-8000-000000000001";

describe("immutable Moment image paths", () => {
  it("builds an owner/Moment/generation path from server values", () => {
    expect(createMomentImagePath(ownerId, momentId, generationId)).toBe(
      `${ownerId}/${momentId}/${generationId}`,
    );
  });

  it("accepts current immutable generations and legacy stable paths for cleanup", () => {
    expect(
      isOwnedMomentImagePath(
        `${ownerId}/${momentId}/${generationId}`,
        ownerId,
        momentId,
      ),
    ).toBe(true);
    expect(
      isOwnedMomentImagePath(
        `${ownerId}/${momentId}/image`,
        ownerId,
        momentId,
      ),
    ).toBe(true);
  });

  it("rejects cross-owner and structurally invalid paths", () => {
    expect(
      isOwnedMomentImagePath(
        `user_b/${momentId}/${generationId}`,
        ownerId,
        momentId,
      ),
    ).toBe(false);
    expect(
      isOwnedMomentImagePath(
        `${ownerId}/${momentId}/not-a-generation`,
        ownerId,
        momentId,
      ),
    ).toBe(false);
  });
});
