import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, createClientMock, getTokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  createClientMock: vi.fn(),
  getTokenMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import {
  createAuthenticatedSupabaseClient,
  SupabaseAuthenticationError,
} from "./server";

describe("createAuthenticatedSupabaseClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    getTokenMock.mockResolvedValue("clerk-session-token");
    authMock.mockResolvedValue({
      getToken: getTokenMock,
      isAuthenticated: true,
      userId: "user_a",
    });
    createClientMock.mockReturnValue({ kind: "supabase-client" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("creates a request-scoped client with the current Clerk session token", async () => {
    const result = await createAuthenticatedSupabaseClient();

    expect(result).toEqual({
      client: { kind: "supabase-client" },
      userId: "user_a",
    });
    expect(getTokenMock).toHaveBeenCalledOnce();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://project-ref.supabase.co",
      "sb_publishable_test",
      {
        accessToken: expect.any(Function),
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );

    const options = createClientMock.mock.calls[0]?.[2];
    await expect(options?.accessToken()).resolves.toBe("clerk-session-token");
  });

  it("rejects requests without an authenticated Clerk user", async () => {
    authMock.mockResolvedValue({
      getToken: getTokenMock,
      isAuthenticated: false,
      userId: null,
    });

    await expect(createAuthenticatedSupabaseClient()).rejects.toEqual(
      expect.objectContaining({
        message: "Authentication is required to access Supabase.",
        name: SupabaseAuthenticationError.name,
      }),
    );
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an authenticated request when Clerk has no session token", async () => {
    getTokenMock.mockResolvedValue(null);

    await expect(createAuthenticatedSupabaseClient()).rejects.toEqual(
      expect.objectContaining({
        message: "Clerk did not provide a Supabase session token.",
        name: SupabaseAuthenticationError.name,
      }),
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("fails closed when required Supabase configuration is missing", async () => {
    vi.stubEnv("SUPABASE_URL", "");

    await expect(createAuthenticatedSupabaseClient()).rejects.toThrow(
      "Missing required environment variable: SUPABASE_URL.",
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
