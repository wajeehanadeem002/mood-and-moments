import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

export type SupabaseQueryResult = {
  data: unknown;
  error: null | { code?: string; message: string };
};

export function createSupabaseClientDouble(
  ...results: SupabaseQueryResult[]
) {
  const queries: Array<{
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }> = [];
  let resultIndex = 0;

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
    client: { from } as unknown as SupabaseClient,
    from,
    queries,
  };
}
