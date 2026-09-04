# H3 Account Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strictly reverified, owner-scoped ZIP export of authenticated cloud Moments and their private images through the existing Clerk UserButton.

**Architecture:** A client-only account export menu action uses Clerk reverification, then performs a bounded, cancellable fetch to a dynamic Next.js Route Handler. The handler independently authenticates and reverifies, consumes a Supabase-backed export allowance, reads owner-scoped rows through stable pagination, and streams private images sequentially into a server-generated `fflate` ZIP that is finalized only after every entry succeeds.

**Tech Stack:** Next.js 16 App Router Route Handlers, TypeScript, Clerk, Supabase PostgreSQL/RLS/Storage, React, `fflate`, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-04-h3-account-data-export-design.md`

## Global constraints

- Implement only H3 `Export my data`; do not implement either deletion action.
- Preserve H1, H2, H4, H6, H9, Moment CRUD, images, imports, and the homepage design.
- Authenticate and strictly reverify before consuming the export allowance; consume it before any data or image read.
- Derive ownership exclusively from Clerk and use the authenticated Supabase/RLS boundary.
- Do not add service-role credentials, client ZIP code, production configuration, or unrelated refactors.
- Do not modify `.env.local`, deploy, commit, or push.

---

### Task 1: Pin the server-only ZIP dependency and define archive behavior

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/lib/account-data-export.ts`
- Create: `src/lib/account-data-export.test.ts`

- [ ] Add `fflate@0.8.3` as an exact production dependency and verify its security metadata.
- [ ] Write failing tests for the versioned manifest, deterministic safe paths, exact original bytes, SHA-256 metadata, empty exports, sequential/backpressured image processing, incomplete-stream rejection, and invalid/missing image failure.
- [ ] Run the focused archive tests and confirm RED for the missing implementation.
- [ ] Implement the minimal server-only export manifest and streaming ZIP builder.
- [ ] Re-run focused tests to GREEN and confirm `fflate` is absent from client modules.

### Task 2: Add the owner-scoped export data adapter

**Files:**
- Create: `src/repositories/supabase-account-export-repository.ts`
- Create: `src/repositories/supabase-account-export-repository.test.ts`

- [ ] Write failing adapter tests for complete database-row mapping, stable 500-row pagination (including 1,000+ rows), page-boundary duplicate/missing-row rejection, owner-scoped/RLS queries, empty results, malformed rows, and provider errors.
- [ ] Run the focused tests and confirm RED.
- [ ] Implement the authenticated Supabase row and private-image read adapter without accepting an owner ID.
- [ ] Re-run focused tests to GREEN.

### Task 3: Extend the authenticated rate limiter

**Files:**
- Create: `supabase/migrations/20260904090000_add_account_export_rate_limit.sql`
- Modify: `supabase/tests/database/moment_api_rate_limits.test.sql`
- Modify: `src/lib/moment-api-rate-limit.ts`
- Modify: `src/lib/moment-api-rate-limit.test.ts`

- [ ] Add failing unit and pgTAP assertions for an owner-scoped `export` bucket at exactly 2 requests per 60 seconds, cross-owner isolation, anonymous denial, and unchanged H4 limits.
- [ ] Run focused tests and record RED evidence.
- [ ] Add a new migration that safely extends the constraint and RPC while preserving prior buckets/grants/RLS.
- [ ] Update the typed client boundary and re-run focused verification to GREEN.

### Task 4: Add strict server reverification and export Route Handler

**Files:**
- Create: `src/lib/account-export-server.ts`
- Create: `src/lib/account-export-server.test.ts`
- Create: `src/app/api/account/export/route.ts`
- Create: `src/app/api/account/export/route.test.ts`

- [ ] Write failing tests proving authentication then strict reverification then rate limiting then data/image reads, plus 401/403/429/503/500 and successful ZIP headers/body.
- [ ] Run focused route/server tests and confirm RED.
- [ ] Implement the POST reverification handshake and dynamic GET download endpoint using Clerk's supported strict response.
- [ ] Re-run focused tests to GREEN.

### Task 5: Add the accessible UserButton export action

**Files:**
- Create: `src/components/account/account-export-action.tsx`
- Create: `src/components/account/account-export-action.test.tsx`
- Modify: `src/components/layout/site-header.tsx`
- Modify: `src/components/layout/site-header.test.tsx`

- [ ] Write failing UI tests for signed-in visibility, menu placement, duplicate prevention through the completed GET, successful file download, reverification retry integration, actual GET failures, bounded cancellation/timeout, retry, and accessible status.
- [ ] Run focused component tests and confirm RED.
- [ ] Implement the action in both existing desktop/mobile UserButtons without redesigning the header.
- [ ] Re-run focused UI tests to GREEN.

### Task 6: Documentation and complete verification

**Files:**
- Modify: `README.md`

- [ ] Document H3 export behavior, migration/deployment order, strict reverification, rate limit, and archive/privacy contract without secrets.
- [ ] Run focused H3 tests.
- [ ] Run the full application suite deterministically.
- [ ] Run database/RLS tests against the approved development database when safely available.
- [ ] Run ESLint, TypeScript type-check, production build, dependency/security audit, and `git diff --check`.
- [ ] Review the complete worktree diff for scope, secrets, generated artifacts, and client bundle isolation.
- [ ] Stop before commit, push, or deploy and report all results.
