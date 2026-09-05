import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

export type SupabaseQueryResult = {
  count?: number | null;
  data: unknown;
  error: null | { code?: string; message: string };
};

export type SupabaseRpcResult = {
  data: unknown;
  error: null | { message: string };
};

type SupabaseClientDoubleOptions = {
  rpcResults?: SupabaseRpcResult[];
};

export function createSupabaseClientDouble(
  ...results: SupabaseQueryResult[]
) {
  return createConfiguredSupabaseClientDouble({}, ...results);
}

export function createConfiguredSupabaseClientDouble(
  options: SupabaseClientDoubleOptions,
  ...results: SupabaseQueryResult[]
) {
  const queries: Array<{
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }> = [];
  let resultIndex = 0;
  let rpcResultIndex = 0;
  const rpc = vi.fn(
    async (
      _functionName: string,
      parameters?: {
        requested_bucket?:
          | "read"
          | "mutation"
          | "import"
          | "export"
          | "delete-data";
      },
    ): Promise<SupabaseRpcResult> => {
      const limit = {
        read: 120,
        mutation: 30,
        import: 10,
        export: 2,
        "delete-data": 2,
      }[parameters?.requested_bucket ?? "read"];

      const configuredResult = options.rpcResults?.[rpcResultIndex];
      rpcResultIndex += 1;

      return configuredResult ?? {
        data: [
          {
            allowed: true,
            limit_value: limit,
            remaining: limit - 1,
            retry_after_seconds: 60,
          },
        ],
        error: null,
      };
    },
  );

  const from = vi.fn(() => {
    const result = results[resultIndex] ?? { data: null, error: null };
    resultIndex += 1;
    const query = {
      delete: vi.fn(),
      eq: vi.fn(),
      insert: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn(async () => result),
      order: vi.fn(),
      range: vi.fn(async () => result),
      select: vi.fn(),
      single: vi.fn(async () => result),
      then: (
        onFulfilled: (value: SupabaseQueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(onFulfilled, onRejected),
      update: vi.fn(),
    };

    query.delete.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.insert.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.update.mockReturnValue(query);
    queries.push(query);

    return query;
  });

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    queries,
    rpc,
  };
}
