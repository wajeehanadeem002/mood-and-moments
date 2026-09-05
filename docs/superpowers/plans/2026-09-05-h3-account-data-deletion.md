# H3 Account Data Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strictly reverified, owner-scoped, durable cloud-data deletion action that never reports success before all Moments, private images, cleanup authorizations, and transient deletion state are gone.

**Architecture:** A Next.js Route Handler authenticates, reverifies, and rate-limits before invoking a server-only deletion service. PostgreSQL independently validates Clerk strict reverification from the signed JWT `fva` claim, then atomically creates or resumes an owner deletion job, authorizes image cleanup, and deletes Moment rows; the service removes private Storage objects and finalizes only after a database-backed zero-state check guarded by the same JWT requirement.

**Tech Stack:** Next.js 16 Route Handlers, Clerk, Supabase PostgreSQL/RLS/Storage, TypeScript, React 19, Vitest, Testing Library, pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-05-h3-account-data-deletion-design.md`

## Global Constraints

- Implement only H3 Action 2; never delete the Clerk account or browser legacy localStorage.
- Preserve H1, H2, H4, H6, H9 and H3 Export behavior.
- Use Clerk `sub` as the sole owner identity and the authenticated Supabase client for all user operations.
- Use no service-role/secret credential and accept no client owner or Storage path.
- Return success only after the verified zero state.
- Do not commit or push until the complete implementation and verification are reviewed.

---

### Task 1: Versioned deletion state and rate-limit migration

**Files:**
- Create: `supabase/migrations/20260905090000_add_account_data_deletion.sql`
- Create: `supabase/tests/database/account_data_deletion.test.sql`
- Modify: `supabase/tests/database/moment_api_rate_limits.test.sql`

- [ ] Write pgTAP assertions for grants, RLS, JWT-derived ownership, atomic owner-only deletion, empty/idempotent calls, concurrent job reuse, active-job insert blocking, zero-state finalization, and the independent two-per-minute bucket.
- [ ] Run the focused database test and confirm RED because the schema/functions/bucket do not exist.
- [ ] Add the minimal migration with the private job table, guarded functions/trigger, and exact rate-limit extension.
- [ ] Run focused pgTAP against an isolated test database or approved hosted Development project and confirm GREEN.

### Task 2: Server-only deletion repository and orchestrator

**Files:**
- Create: `src/repositories/supabase-account-data-deletion-repository.ts`
- Create: `src/repositories/supabase-account-data-deletion-repository.test.ts`
- Create: `src/lib/account-data-deletion.ts`
- Create: `src/lib/account-data-deletion.test.ts`

- [ ] Write repository tests for RPC validation, stable cleanup-path pagination, malformed results, owner-hidden results, and final status mapping.
- [ ] Run them and confirm RED because the repository does not exist.
- [ ] Implement the smallest server-only repository interface.
- [ ] Write service tests proving database-first ordering, no Storage call after begin failure, sequential cleanup, partial failure, retry, response loss, 1,000+ paths, zero-state gating, concurrent idempotency, and the explicit incomplete contract for post-begin listing/verification failures.
- [ ] Run them and confirm RED because the service does not exist.
- [ ] Implement the orchestrator using `SupabaseMomentImageRepository.remove()` and durable cleanup completion.
- [ ] Run repository/service tests and confirm GREEN.

### Task 2A: Serialize in-flight private image uploads with deletion

**Files:**
- Create: `supabase/migrations/20260905110000_lock_moment_image_uploads_during_account_deletion.sql`
- Create: `supabase/tests/database/account_data_deletion_storage_lock.test.sql`
- Create: `supabase/tests/hosted/account_data_deletion_storage_race.test.mjs`

- [ ] Prove RED with an authenticated, authorized, uncommitted Storage INSERT that can otherwise outlive successful deletion finalization.
- [ ] Add a fail-closed JWT-derived Storage INSERT guard that acquires the same owner advisory transaction lock and rejects active deletion jobs without weakening H2/H6 predicates.
- [ ] Run focused policy pgTAP and the real hosted concurrency transaction and confirm GREEN.

### Task 3: Strictly reverified API and deletion error contract

**Files:**
- Create: `src/app/api/account/data/route.ts`
- Create: `src/app/api/account/data/route.test.ts`
- Modify: `src/lib/moment-api-rate-limit.ts`
- Modify: `src/lib/moment-api-rate-limit.test.ts`
- Modify: `src/test/supabase-query-double.ts`

- [ ] Write route and limiter tests for strict reverification, auth/reverify/rate-limit/data ordering, no browser owner input, 204, standard 429, limiter 503, incomplete-cleanup 503, and sanitized failures.
- [ ] Run them and confirm RED for the missing route and bucket.
- [ ] Implement the `POST` handshake, `DELETE` handler, independent `delete-data` bucket, and private response mapping.
- [ ] Run focused route/limiter tests and confirm GREEN.

### Task 4: Accessible UserButton deletion action

**Files:**
- Create: `src/components/account/account-data-deletion-action.tsx`
- Create: `src/components/account/account-data-deletion-action.test.tsx`
- Modify: `src/components/account/account-export-action.tsx`
- Modify: `src/components/account/account-export-action.test.tsx`
- Modify: `src/components/layout/site-header.test.tsx`

- [ ] Write tests for signed-in placement, exact confirmation phrase, focus trap/background inertness/focus restoration, one bounded timeout across the reverify handshake and DELETE, accessible status, strict reverification, duplicate prevention, safe retry, incomplete/ambiguous errors, verified success reload, and unchanged export behavior.
- [ ] Run them and confirm RED for the missing action.
- [ ] Implement the minimal menu item and dialog without redesigning the header.
- [ ] Run focused UI tests and confirm GREEN.

### Task 5: Documentation and complete verification

**Files:**
- Modify: `README.md`

- [ ] Document scope, migration order, strict reverification, rate limit, failure/retry behavior, and exclusions without secrets.
- [ ] Run all focused tests and the complete application suite.
- [ ] Run pgTAP Moments/RLS, Storage/RLS, H4 rate limits, H6 concurrency, and Action 2 tests.
- [ ] Run ESLint, TypeScript, production build, and `git diff --check`.
- [ ] Apply only the new migration to the isolated Development Supabase project after local review.
- [ ] Run hosted two-user, concurrent, partial-failure/retry, Storage-zero, responsive, accessibility, H1/H2/H4/H6/H9, and runtime-log verification.
- [ ] Remove all disposable users/data and report the final diff/status without committing or pushing.
