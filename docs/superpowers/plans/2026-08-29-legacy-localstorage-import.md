# Legacy localStorage Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, non-destructive, retry-safe import of legacy browser Moments into the authenticated Supabase account.

**Architecture:** A read-only browser source adapter classifies local records, a dedicated API client submits them sequentially, and an authenticated Route Handler uses a Supabase import service with durable owner-scoped idempotency. The existing Moment and image repositories remain the cloud persistence boundary.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Clerk, Supabase PostgreSQL/Storage, Vitest, Testing Library, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-29-legacy-localstorage-import-design.md`

## Global Constraints

- Do not commit or push during implementation.
- Never inspect or import localStorage automatically on sign-in.
- Never accept a client owner id, cloud id, or Storage path.
- Do not modify the two verified foundation migrations.
- Preserve Milestones 1–4, static examples, and the visual system.
- Add no service-role credential, auth provider, import provider, or dependency.

---

### Task 1: Non-destructive legacy source model

**Files:**
- Create: `src/lib/legacy-moment-import.test.ts`
- Create: `src/lib/legacy-moment-import.ts`
- Create: `src/repositories/local-storage-legacy-moment-source.test.ts`
- Create: `src/repositories/local-storage-legacy-moment-source.ts`

**Interfaces:**
- Produces parsed preview items, decoded image files, source hashes, account association state, receipts, and exact-match cleanup results.

- [ ] Write failing tests for root limits, mixed records, duplicate ids, core normalization, invalid images, account mismatch, receipts, and concurrent cleanup changes.
- [ ] Run the focused tests and confirm failures are caused by missing behavior.
- [ ] Implement the minimal parser and browser adapter.
- [ ] Run focused and existing localStorage tests.

### Task 2: Database import identity and time preservation

**Files:**
- Create: `supabase/migrations/20260829213000_add_legacy_moment_import_idempotency.sql`
- Modify: `supabase/tests/database/moments_rls.test.sql`
- Modify: `src/repositories/supabase-moment-repository.test.ts`
- Modify: `src/repositories/supabase-moment-repository.ts`

**Interfaces:**
- Produces `findImportRecord`, `createImported`, and immutable import metadata mapped without exposing it to application Moments.

- [ ] Add failing repository and pgTAP assertions for preserved time, per-owner uniqueness, immutable metadata, RLS, and normal-row fallback.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add the versioned migration and minimal repository methods.
- [ ] Run repository tests and SQL syntax/diff checks.

### Task 3: Authenticated import service and API

**Files:**
- Create: `src/lib/legacy-moment-import-request.test.ts`
- Create: `src/lib/legacy-moment-import-request.ts`
- Create: `src/lib/authenticated-moment-import-service.test.ts`
- Create: `src/lib/authenticated-moment-import-service.ts`
- Create: `src/app/api/moments/import/route.test.ts`
- Create: `src/app/api/moments/import/route.ts`
- Modify: `src/lib/moment-api-server.ts`
- Modify: `src/lib/moment-api-server.test.ts`

**Interfaces:**
- Consumes authenticated Supabase Moment and image repositories.
- Produces strict multipart validation and `created`, `already_imported`, and `completed_existing` outcomes.

- [ ] Write failing validation, idempotency, concurrency, image recovery, authentication, conflict, and compensation tests.
- [ ] Run focused tests and verify RED.
- [ ] Implement server hashing, import reconciliation, and the Route Handler without service-role access.
- [ ] Run focused route/service tests and existing CRUD/image tests.

### Task 4: Browser API adapter and accessible import UI

**Files:**
- Create: `src/repositories/api-legacy-moment-import-repository.test.ts`
- Create: `src/repositories/api-legacy-moment-import-repository.ts`
- Create: `src/components/home/legacy-moment-import.test.tsx`
- Create: `src/components/home/legacy-moment-import.tsx`
- Modify: `src/components/home/moments-experience.tsx`
- Modify: `src/app/page.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Produces an explicit signed-in review/import/cleanup flow and returns confirmed Moments to the existing page state.

- [ ] Write failing API adapter and UI tests for explicit inspection, preview, account binding, progress, invalid-image imports, retries, sign-out, exact cleanup, and Recent/Timeline updates.
- [ ] Run focused tests and verify RED.
- [ ] Implement the API adapter, panel, session integration, and current-architecture documentation.
- [ ] Run focused UI tests and the full Vitest suite.

### Task 5: Hosted and release verification

**Files:**
- Modify only focused verification scripts if hosted execution exposes a real unsupported test operation.

**Interfaces:**
- Produces fresh evidence for database ownership, idempotency, private images, application behavior, build health, and responsive layout.

- [ ] Apply only the new migration to the linked development/testing Supabase project.
- [ ] Run complete pgTAP and hosted Clerk/Supabase import verification without exposing credentials.
- [ ] Run all tests, ESLint, TypeScript, production build, and `git diff --check`.
- [ ] Run Chrome QA at 1440, 768, 390, and 320 px with overflow, console, page-error, and accessibility checks.
- [ ] Review the complete diff and report results without committing or pushing.
