# H3 Account Data Deletion Design

## Scope

This action deletes the authenticated Clerk user's cloud Mood & Moments data while preserving the Clerk account, legacy browser localStorage, operational rate-limit counters, static example Moments, and the existing account export feature.

The action is explicit, irreversible, and protected by Clerk strict reverification. No request accepts an owner ID, Clerk user ID, Moment ID, Storage path, or deletion-operation ownership from the browser.

## User flow

The existing Clerk UserButton menu gains `Delete my Mood & Moments data`. Activating it opens an accessible confirmation dialog that explains the scope and requires the exact phrase `DELETE MY DATA`.

After confirmation, the client performs a lightweight `POST /api/account/data` through Clerk `useReverification`. One bounded 120-second abort scope covers that POST/reverification handshake and the subsequent real DELETE. The real `DELETE /api/account/data` independently repeats authentication and strict reverification, consumes the dedicated deletion allowance, and starts or resumes deletion. The UI prevents duplicate activation, traps focus inside the modal, makes background content inert, restores focus on close/completion, reports progress through an aria-live region, and presents a safe retry action after an incomplete or ambiguous result. A verified `204` reloads the page so authenticated cloud Moments disappear immediately while static examples remain.

## Request ordering and contract

Every real deletion uses this order:

1. Clerk authentication and strict reverification.
2. Authenticated Supabase client created from the Clerk session JWT.
3. Owner-scoped `delete-data` rate limit, two requests per 60 seconds.
4. Database deletion preparation and commit.
5. Private Storage cleanup.
6. Database and Storage verification and deletion-job finalization.

`POST /api/account/data` returns `204` after strict reverification and performs no rate-limit, database, or Storage work. `DELETE /api/account/data` returns `204` only after complete verification. Authentication/reverification errors retain Clerk's response, exceeded limits retain the standard private `429` metadata, limiter failure returns private `503 SERVICE_UNAVAILABLE`, and incomplete cleanup returns private `503 ACCOUNT_DATA_DELETION_INCOMPLETE`. Unexpected failures are sanitized.

## Durable database state

A new private `public.account_data_deletion_jobs` table contains one active operation per Clerk subject: `owner_id`, generated `operation_id`, `status = cleanup_pending`, `created_at`, and `updated_at`. It contains no Moment content, image bytes, email, token, or credential. RLS is enabled and direct table privileges are revoked.

`public.begin_account_data_deletion()` takes no arguments. As a tightly scoped `security definer` wrapper with an empty search path, it validates the authenticated JWT role and `sub` and independently requires a signed Clerk `fva` claim satisfying Clerk's strict semantics: a fresh second factor when present, otherwise a fresh first factor, with a ten-minute exclusive boundary. Missing, malformed, unsupported-negative, and stale claims fail closed. Its non-executable internal implementation acquires an owner-scoped advisory transaction lock, creates or resumes the deletion job, validates every owned Storage object path, establishes durable cleanup authorization for active and recoverable owned image objects, and deletes only that owner's Moment rows. The transaction rolls back as one unit if preparation cannot complete.

An owner-aware `BEFORE INSERT` trigger on `public.moments` acquires the same advisory lock and rejects new inserts while deletion is active. A creation that commits before deletion is included in the delete; a creation that follows the pending job is rejected. Existing H6 update/delete locking and CAS behavior remains unchanged.

The private Storage INSERT policy calls a fail-closed owner guard that derives the Clerk subject from the signed JWT, acquires the same advisory transaction lock, and rejects the upload while a deletion job exists. A previously authorized upload transaction therefore finishes before deletion can snapshot/finalize, while an upload that starts after deletion owns the lock is rejected. Existing H2 path, Moment ownership, cleanup-authorization, and immutable-generation predicates remain unchanged.

The existing `public.moment_image_cleanup_authorizations` table remains the durable Storage work queue. Existing private Storage SELECT/DELETE policies already allow only the authenticated owner to observe and delete an active or cleanup-authorized path; they are not weakened.

`public.verify_and_finish_account_data_deletion(operation_id)` repeats the signed-JWT strict-`fva` check, binds the operation to the authenticated `sub`, takes the same advisory lock, and verifies that owned Moment rows, owned Storage objects, and owned cleanup authorizations are all zero. Only then does its non-executable internal implementation remove the deletion job and report completion. The operation ID is server-internal and never authorizes a different owner.

## Storage lifecycle

Actual Storage deletion starts only after the database deletion transaction commits. The server pages through owner-visible cleanup authorizations in stable path order, removes objects sequentially with the authenticated Storage SDK, and calls the existing `complete_moment_image_cleanup()` after each remove. That RPC proves the object is absent before clearing its authorization, so a nominally successful Storage HTTP response cannot create false success.

If database preparation or its Storage-metadata validation fails, the transaction rolls back and no Storage operation starts. After preparation commits, cleanup-path listing failures, partial Storage cleanup, and final-verification failures all return the explicit retryable `503 ACCOUNT_DATA_DELETION_INCOMPLETE`; provider details are never exposed. Moment rows remain deleted, while the job and remaining cleanup authorizations persist for retry. Deleted rows are not reconstructed because partial image removal makes safe restoration impossible.

An object removed before cleanup-finalization failure is handled idempotently on retry: removing an already absent object is safe, and the existing completion RPC then clears the authorization. A lost HTTP response is also resolved by repeating the same authenticated operation and final verification.

## Concurrency and idempotency

One job exists per owner. Repeated and concurrent requests resume the same operation. Database preparation is serialized by the owner advisory lock. Storage removal and cleanup completion are idempotent; concurrent requests may both return `204` only after the shared final state is proven empty.

Different Clerk subjects have independent jobs, rate-limit buckets, Moments, cleanup authorizations, and Storage prefixes. All database functions derive identity from `auth.jwt()->>'sub'` and explicitly constrain every privileged query by that value.

## Privacy and logging

The route logs only a random correlation identifier, lifecycle stage, and aggregate counts. It never logs Clerk subjects, Moment content, Storage paths, JWTs, keys, passwords, raw provider responses, or image bytes. No service-role or Supabase secret credential is introduced.

Operational rate-limit rows remain because they are security metadata for the retained Clerk account. Browser-local legacy data remains under its existing explicit cleanup workflow. The UI states these exclusions before confirmation.

## Verification

Coverage must prove strict reverification and request ordering, owner isolation, empty/idempotent deletion, database-first behavior, rollback before database commit, partial Storage failure, durable retry, response loss, pagination beyond 1,000 images, final zero-state verification, concurrent requests, Moment insert blocking, and a genuine uncommitted Storage INSERT transaction that cannot outlive successful deletion finalization. Hosted verification uses two real Development Clerk users and the isolated Development Supabase project. H1, H2, H4, H6, H9, export, CRUD, import, image lifecycle, signed-out, responsive, and accessibility behavior remain green.
