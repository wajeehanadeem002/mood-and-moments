export function validateMomentText(value: string): string | null {
  if (!value.trim()) {
    return "Write a few words about the moment you want to remember.";
  }

  return null;
}

export function createMomentConfirmation(moodLabel: string): string {
  return `Your ${moodLabel} moment is ready in this preview.`;
}
