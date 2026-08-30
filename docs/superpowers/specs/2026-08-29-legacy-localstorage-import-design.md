# Legacy localStorage Import Design

## Goal

Allow an authenticated Clerk user to explicitly review and import valid Moments from `mood-and-moments.moments.v1` into their Supabase-backed account without automatic migration or local data loss.

## Architecture

The signed-in homepage exposes a user-triggered import panel. A non-destructive browser adapter inspects and classifies legacy records without reading storage on sign-in. Importable records are submitted one at a time to an authenticated Route Handler; Clerk supplies identity, PostgreSQL provides owner-scoped idempotency, and the existing private Storage lifecycle handles valid images.

The client never supplies an owner, cloud Moment id, or Storage path. Static examples and ordinary cloud Moments are never migration candidates.

## Legacy validation

The source must be a JSON array of no more than 500 entries and at most 10,000,000 characters. An importable core record has a trimmed source id of 1–255 characters, a unique id within the array, a trimmed title of 1–80 characters, a trimmed description of 1–280 characters, a supported mood, and a valid date/time derived from `dateTime`. Redundant legacy display fields are ignored. Malformed records are skipped individually; malformed root data produces a source-level error. Inspection never deletes or rewrites source storage.

Optional images must be JPEG, PNG, or WebP data URLs whose decoded body is 1–1,000,000 bytes and whose file signature matches the declared MIME type. Invalid images do not block the core Moment: the Moment imports without an image, receives a visible warning, and remains local.

## API and persistence

`POST /api/moments/import` accepts one strict multipart request containing `sourceId`, `title`, `description`, `mood`, `date`, `time`, and an optional `image`. It rejects duplicate/unknown fields and never accepts ownership, cloud ids, or paths.

The server computes a SHA-256 hash over normalized source id, title, description, mood, date, and time. The browser separately hashes the complete parsed local record for exact-match cleanup, so a concurrent image-only or metadata change cannot be deleted accidentally. A new migration adds nullable `moment_time`, `import_source`, `import_source_id`, and `import_source_hash` columns plus constraints and a partial unique index on `(owner_id, import_source, import_source_id)`. Imported records use `legacy-localstorage-v1`. Existing RLS derives `owner_id` from Clerk's JWT `sub`; import metadata is insertable but immutable.

The route returns `201` for a new import and `200` for an idempotent retry or recovered image. Matching source ids with changed normalized content return `409`. Validation returns `422`, missing auth returns `401`, malformed form data returns `400`, and persistence failures return `500` through the existing error envelope.

## Images and compensation

The browser decodes a valid data URL to a `File`; the server repeats MIME, size, and signature validation. Storage paths remain `<clerk-user-id>/<cloud-moment-id>/image` and are constructed only by the authenticated service.

Each item is independent. No local receipt is recorded until a confirmed cloud response. A newly created row is removed if its image cannot be uploaded or linked, and a newly written object is removed if linking fails. Cleanup failures are logged without content or image bytes. Durable idempotency reconciles retries after response loss or incomplete cleanup.

## Browser association and cleanup

Storage is inspected only after a signed-in user selects “Review legacy Moments.” The first confirmed import binds the dataset to a SHA-256 fingerprint of that Clerk user id in `mood-and-moments.legacy-import-state.v1`. A different account is blocked in this milestone. The marker is a UX guard; Clerk plus RLS remain the security boundary.

Cleanup is explicit and confirmed. It removes only records whose id, complete local-record hash, durable source hash, and image-complete receipt still match a fully represented successful import. Failed, skipped, conflicted, changed, and invalid-image text-only sources remain in original order. Storage failures preserve cloud data and report that the local cleanup did not complete.

## UI and accessibility

The import panel follows the existing dark visual system and appears only for authenticated users. It supports idle, inspection, preview, confirmation, importing, result, retry, association-blocked, and cleanup states. It uses semantic headings, a native progress element, `aria-busy`, polite status updates, alert semantics, focus restoration, keyboard-accessible confirmations, 44px targets, concurrency locks, and existing reduced-motion rules.

Confirmed imports update Recent Moments and Memory Timeline immediately. Signing out aborts the client flow and hides private data; an in-flight server completion remains safe to retry.

## Approved product decisions

- Invalid legacy images produce a clearly labelled text-only cloud import and preserve the local source.
- The first successfully importing Clerk account binds the dataset; no cross-account override exists in this milestone.
- `moment_time` preserves legacy display time, while existing cloud rows continue falling back to `created_at`.
- Cleanup is never automatic and only removes fully represented successful imports.

## Constraints

No service-role key, auth-provider change, homepage redesign, static-data mutation, uploaded-file import, cross-account transfer, automatic migration, or new dependency is permitted.
