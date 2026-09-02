# H6 Cloud CRUD Concurrency Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale ordinary cloud Moment edits, deletes, and image lifecycle operations from silently overwriting a newer authenticated state.

**Architecture:** Add a database-controlled monotonic `revision`, authenticated compare-and-swap RPCs, immutable generation-specific private image paths, and owner-scoped cleanup authorizations. Expose the current revision through the existing repository/API boundary, require `X-Moment-Revision` for PATCH/DELETE, and surface conflicts without discarding the user's draft.

**Tech Stack:** Next.js 16 App Router Route Handlers, TypeScript, Clerk, Supabase PostgreSQL/RLS/Storage, React, Vitest, pgTAP.

**Spec:** Approved H6 scope in the 2026-09-01 conversation.

## Global Constraints

- Implement H6 only; preserve B1, B2, H1, H2, B3, H4, H9, and both hydration fixes.
- Use `revision bigint NOT NULL DEFAULT 1`, controlled exclusively by the database trigger.
- Require `X-Moment-Revision` for authenticated PATCH/DELETE and return the approved 428/400/412/404 contracts.
- Use immutable owner/Moment/generation private Storage objects and durable owner-scoped cleanup authorizations.
- Never accept an owner identifier or arbitrary Storage path from the browser.
- Keep authentication and H4 evaluation ahead of mutation processing.
- Do not add dependencies, modify `.env.local`, deploy, commit, or push.

---

### Task 1: Database revision, CAS, and cleanup foundation

**Files:**
- Create: `supabase/migrations/20260901090000_add_moment_revision_concurrency.sql`
- Modify: `supabase/tests/database/moments_rls.test.sql`
- Modify: `supabase/tests/database/moment_images_rls.test.sql`

**Interfaces:**
- Produces: authenticated RPCs for candidate authorization, revision-checked update/delete, and cleanup completion.
- Produces: immutable image path and cleanup-authorization RLS policies.

- [ ] Add failing pgTAP assertions for revision defaults, trigger increments, direct revision-write denial, stale CAS, cross-owner denial, immutable Storage generations, and cleanup authorization isolation.
- [ ] Run the database test through the available safe database harness and confirm the new assertions fail because the migration is absent.
- [ ] Add the versioned migration with `revision`, cleanup authorization table, fixed-search-path RPCs, grants, RLS, and tightened Storage policies.
- [ ] Re-run pgTAP and confirm all new and existing assertions pass.

### Task 2: Server repository CAS boundary

**Files:**
- Modify: `src/data/moments.ts`
- Modify: `src/repositories/moment-repository.ts`
- Modify: `src/repositories/supabase-moment-repository.ts`
- Modify: `src/repositories/supabase-moment-repository.test.ts`
- Modify: `src/test/supabase-query-double.ts`

**Interfaces:**
- Produces: optional application `revision`, required for cloud mutations.
- Produces: typed `MomentVersionConflictError` carrying the latest owner-scoped Moment.
- Produces: repository methods that authorize immutable image candidates and complete durable cleanup records.

- [ ] Write failing row-mapping and RPC outcome tests for current, stale, missing, and cross-owner-hidden Moments.
- [ ] Run the focused repository test and confirm RED failures are caused by missing revision/CAS behavior.
- [ ] Implement the minimal typed mapping and RPC adapters.
- [ ] Re-run the focused repository tests to GREEN.

### Task 3: Immutable image lifecycle and concurrent saga safety

**Files:**
- Create: `src/lib/moment-image-path.ts`
- Create: `src/lib/moment-image-path.test.ts`
- Modify: `src/lib/authenticated-moment-service.ts`
- Modify: `src/lib/authenticated-moment-service.test.ts`
- Modify: `src/lib/authenticated-moment-import-service.ts`
- Modify: `src/lib/authenticated-moment-import-service.test.ts`
- Modify: `src/repositories/supabase-moment-image-repository.ts`
- Modify: `src/repositories/supabase-moment-image-repository.test.ts`

**Interfaces:**
- Produces: `<owner>/<moment>/<generation-uuid>` paths created only on the server.
- Consumes: candidate authorization before upload and atomic row CAS after upload.
- Guarantees: a losing request removes only its own generation; cleanup failures retain durable authorization without restoring over a winner.

- [ ] Write failing service tests for PATCH/PATCH, PATCH/DELETE, DELETE/DELETE, image A/B, failed candidate cleanup, and legacy stable-object cleanup.
- [ ] Run the focused tests and record the expected stale-write/compensation failures.
- [ ] Implement upload-authorize-CAS-switch-cleanup sequencing and import compatibility.
- [ ] Re-run the service and image repository tests to GREEN.

### Task 4: HTTP precondition contract

**Files:**
- Modify: `src/lib/moment-api-server.ts`
- Modify: `src/lib/moment-api-server.test.ts`
- Modify: `src/app/api/moments/[id]/route.ts`
- Modify: `src/app/api/moments/[id]/route.test.ts`
- Modify: `src/app/api/moments/route.test.ts`
- Modify: `src/app/api/moments/import/route.test.ts`

**Interfaces:**
- Consumes: `X-Moment-Revision: <positive revision>` on PATCH/DELETE.
- Produces: `428 PRECONDITION_REQUIRED`, `400 INVALID_PRECONDITION`, and `412 MOMENT_VERSION_CONFLICT` with the latest owner-scoped Moment.

- [ ] Add failing contract/order tests, including authentication and H4 consumption before precondition handling.
- [ ] Run the route tests and confirm RED status/header/body failures.
- [ ] Implement strict precondition parsing and typed conflict responses with `private, no-store`.
- [ ] Re-run route tests to GREEN.

### Task 5: Client repository and accessible conflict recovery

**Files:**
- Modify: `src/lib/moment-creation.ts`
- Modify: `src/repositories/api-moment-repository.ts`
- Modify: `src/repositories/api-moment-repository.test.ts`
- Modify: `src/repositories/api-legacy-moment-import-repository.ts`
- Modify: `src/repositories/api-legacy-moment-import-repository.test.ts`
- Modify: `src/components/home/moments-experience.tsx`
- Modify: `src/components/home/mood-ritual.tsx`
- Modify: `src/components/home/hero.tsx`
- Modify: `src/components/home/recent-moments.tsx`
- Modify: `src/app/page.test.tsx`

**Interfaces:**
- Sends: `X-Moment-Revision` from the cloud Moment revision on PATCH/DELETE.
- Produces: an accessible conflict alert and explicit `Load latest Moment` action.
- Guarantees: drafts and cards remain intact until the user explicitly accepts the latest version.

- [ ] Add failing API repository and UI tests for revision headers, preserved drafts, explicit reload, delete conflicts, and imported Moment editability.
- [ ] Run focused tests and confirm RED failures.
- [ ] Implement the smallest repository/UI changes without automatic retry or force overwrite.
- [ ] Re-run focused tests to GREEN.

### Task 6: Full verification and review handoff

**Files:**
- Verify only; no additional production changes unless a failing H6 regression requires them.

- [ ] Run all focused repository/service/API/UI tests.
- [ ] Run the full Vitest suite deterministically.
- [ ] Run local/hosted pgTAP and Storage verification only when applying the migration is explicitly authorized.
- [ ] Run ESLint, TypeScript, production build, and `git diff --check`.
- [ ] Review the complete diff for H6-only scope, secrets, generated files, and migration immutability.
- [ ] Report any hosted verification blocked by the no-deployment constraint without weakening tests.
