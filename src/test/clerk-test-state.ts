export type ClerkTestAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
};

const defaultAuthState: ClerkTestAuthState = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user_test",
};

export const clerkTestAuthState: ClerkTestAuthState = {
  ...defaultAuthState,
};

export function setClerkTestAuthState(
  state: Partial<ClerkTestAuthState>,
) {
  Object.assign(clerkTestAuthState, state);
}

export function resetClerkTestAuthState() {
  Object.assign(clerkTestAuthState, defaultAuthState);
}
