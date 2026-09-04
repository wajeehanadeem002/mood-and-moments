# H3 Account Data Export Design

## Goal

Allow an authenticated Mood & Moments user to explicitly export all of their cloud-owned Moment data and private image files as a self-contained ZIP archive from the existing Clerk UserButton menu.

This milestone implements only **Export my data**. The two separately approved deletion actions remain outside this bounded change.

## User flow

The signed-in Clerk UserButton contains an `Export my data` action. Selecting it starts a small client action protected by Clerk's `useReverification` flow. If the current session does not satisfy strict reverification, Clerk prompts the user and retries the action after successful verification. Cancellation or request failure is surfaced through an accessible status message without navigating away.

After the authorization action succeeds, the client fetches `GET /api/account/export` and keeps the account action busy until the response body is completely received or fails. The request uses a bounded `AbortController`, supports explicit cancellation, and validates the completed ZIP structure before starting the browser download. That download endpoint independently requires authenticated Clerk identity and strict reverification before it consumes an owner-scoped export rate-limit allowance. No identity, owner identifier, Storage path, token, or credential is accepted from the browser.

## Authorization and operation order

Every export request follows this order:

1. Clerk authentication and strict session reverification.
2. Supabase PostgreSQL-backed `export` rate limit, keyed by authenticated Clerk `sub`, with 2 requests per fixed 60-second window.
3. RLS-backed reads of the user's Moment rows and private image objects through the authenticated Supabase client.
4. Server-side ZIP generation.

The existing `read`, `mutation`, and `import` H4 buckets and their limits remain unchanged. A limiter outage fails closed with the existing private `503 SERVICE_UNAVAILABLE` response. Exceeded exports return the existing private `429 RATE_LIMITED` response and standard rate-limit metadata.

## Archive contract

The download filename is `mood-and-moments-export-YYYY-MM-DD.zip`. The ZIP contains:

- `manifest.json`
- `images/<moment-id>.jpg`, `.png`, or `.webp` for each Moment that has an image

The versioned JSON manifest contains:

- archive format and schema version `1`
- UTC export timestamp
- every user-owned Moment's id, revision, title, description, mood, date, optional original Moment time, createdAt, and updatedAt
- relevant legacy-import metadata for imported Moments
- image archive path, MIME type, byte length, and SHA-256 digest when an image exists

It deliberately excludes Clerk user IDs, owner IDs, raw Supabase Storage paths, access tokens, keys, credentials, and unavailable original upload filenames. Archive names are generated only from validated server data.

The server fetches Moment rows in stable 500-row pages ordered by date, creation time, and unique Moment ID. Exact-count and duplicate checks fail closed if pagination skips or repeats a row. Images are then read and appended sequentially with stream backpressure, so prepared image bytes are not retained as one archive-sized collection in memory. The manifest and final ZIP directory are emitted only after every required image succeeds. A missing, unreadable, unsupported, or inconsistent image aborts the response stream before a valid complete ZIP can be finalized. Source images are individually bounded by the existing 1,000,000-byte Moment image limit. `fflate` is imported only by server-only archive code and emits the ZIP through a Web `ReadableStream`; no ZIP library is shipped to the client.

## HTTP contract

`POST /api/account/export` is the lightweight reverification action. It authenticates, enforces strict Clerk reverification, and returns `204` without reading data or consuming the export allowance.

`GET /api/account/export` performs the complete ordered export flow and returns:

- `200 application/zip` with `Content-Disposition: attachment` on success
- `401 UNAUTHORIZED` when signed out
- Clerk's strict reverification response when the session is not recently verified
- `429 RATE_LIMITED` with `Retry-After`, `RateLimit-*`, and `Cache-Control: private, no-store`
- `503 SERVICE_UNAVAILABLE` if rate limiting is unavailable
- a private `500 INTERNAL_ERROR` for export persistence/archive failures without exposing provider details

Successful ZIP responses include `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

## UI and accessibility

The feature uses Clerk's existing UserButton menu on desktop and mobile and does not redesign the header or homepage. A small reusable account-export action owns its in-progress state and an `aria-live` status region. It prevents duplicate activation, keeps the action locked until the real download finishes, supports explicit cancellation and a bounded timeout, identifies reverification cancellation without treating it as an application error, and makes actual GET failures and retry outcomes observable without exposing provider details.

## Database migration

A new versioned migration extends the existing rate-limit bucket constraint and RPC with `export` at 2 requests per 60 seconds. The already verified H4 `read` (120), `mutation` (30), and `import` (10) behavior, grants, owner-scoped keys, and RLS remain unchanged.

## Security boundaries

- Clerk is the sole identity source.
- Supabase Auth is not used.
- User CRUD/export uses only the authenticated publishable-key client and Clerk session JWT.
- PostgreSQL RLS and private Storage policies continue to enforce owner access.
- No service-role or secret key is introduced.
- No localStorage data or static example Moments are included.
- No secrets or personal content are logged.
- ZIP entry names cannot be supplied by the client.

## Testing

Coverage includes manifest/archive contents and image integrity, stable pagination beyond 1,000 rows and pagination-integrity failures, bounded sequential image processing and incomplete-stream rejection, RLS-backed row mapping, missing/corrupt image failure, authentication and strict reverification ordering, export rate-limit boundaries/metadata/fail-closed behavior, no data reads before those gates, actual GET failures, duplicate activation, cancellation, timeout/retry states, UserButton accessibility, and database authorization for the new bucket. Existing H1, H2, H4, H6, H9, Moment CRUD, image, import, signed-out, and responsive behavior must remain green.
