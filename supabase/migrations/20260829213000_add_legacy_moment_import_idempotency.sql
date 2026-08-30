alter table public.moments
  add column moment_time time(0),
  add column import_source text,
  add column import_source_id text,
  add column import_source_hash text;

alter table public.moments
  add constraint moments_import_metadata_complete check (
    (
      moment_time is null
      and import_source is null
      and import_source_id is null
      and import_source_hash is null
    )
    or
    (
      moment_time is not null
      and import_source = 'legacy-localstorage-v1'
      and import_source_id = btrim(import_source_id)
      and char_length(import_source_id) between 1 and 255
      and import_source_hash ~ '^[a-f0-9]{64}$'
    )
  );

create unique index moments_owner_import_source_idx
  on public.moments (owner_id, import_source, import_source_id)
  where import_source is not null;

grant insert (moment_time, import_source, import_source_id, import_source_hash)
  on table public.moments to authenticated;

comment on column public.moments.moment_time is
  'Original local display time for explicitly imported legacy Moments.';
comment on column public.moments.import_source is
  'Nullable immutable import source discriminator.';
comment on column public.moments.import_source_id is
  'Owner-scoped immutable source identifier used for import idempotency.';
comment on column public.moments.import_source_hash is
  'SHA-256 of normalized imported Moment text, mood, date, and time.';
