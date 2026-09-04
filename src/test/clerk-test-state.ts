export type ClerkTestAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
};

export type ClerkTestReverificationOperation = () => Promise<unknown>;
export type ClerkTestReverificationWrapper = (
  operation: ClerkTestReverificationOperation,
) => Promise<unknown>;

const defaultAuthState: ClerkTestAuthState = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user_test",
};

export const clerkTestAuthState: ClerkTestAuthState = {
  ...defaultAuthState,
};

export const clerkTestReverificationState: {
  wrapper: ClerkTestReverificationWrapper | null;
} = {
  wrapper: null,
};

export function setClerkTestAuthState(
  state: Partial<ClerkTestAuthState>,
) {
  Object.assign(clerkTestAuthState, state);
}

export function resetClerkTestAuthState() {
  Object.assign(clerkTestAuthState, defaultAuthState);
  clerkTestReverificationState.wrapper = null;
}

export function setClerkTestReverificationWrapper(
  wrapper: ClerkTestReverificationWrapper,
) {
  clerkTestReverificationState.wrapper = wrapper;
}
