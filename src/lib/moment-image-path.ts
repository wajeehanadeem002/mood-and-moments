const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasSafeOwnerId(ownerId: string): boolean {
  return ownerId.length > 0 && !ownerId.includes("/");
}

export function createMomentImagePath(
  ownerId: string,
  momentId: string,
  generationId: string,
): string {
  if (
    !hasSafeOwnerId(ownerId) ||
    !uuidPattern.test(momentId) ||
    !uuidPattern.test(generationId)
  ) {
    throw new Error("The Moment image path values are invalid.");
  }

  return `${ownerId}/${momentId}/${generationId}`;
}

export function isOwnedMomentImagePath(
  imagePath: string,
  ownerId: string,
  momentId: string,
): boolean {
  if (!hasSafeOwnerId(ownerId) || !uuidPattern.test(momentId)) return false;

  const segments = imagePath.split("/");
  return (
    segments.length === 3 &&
    segments[0] === ownerId &&
    segments[1] === momentId &&
    (segments[2] === "image" || uuidPattern.test(segments[2] ?? ""))
  );
}
