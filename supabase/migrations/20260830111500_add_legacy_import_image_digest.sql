do $$
begin
  if exists (
    select 1
    from public.moments
    where import_source = 'legacy-localstorage-v1'
      and image_path is not null
  ) then
    raise exception using
      message = 'Cannot add import image digests while legacy imported images require a verified byte-level backfill.';
  end if;
end;
$$;

alter table public.moments
  add column import_image_hash text;

alter table public.moments
  add constraint moments_import_image_hash_complete check (
    (
      import_source is null
      and import_image_hash is null
    )
    or
    (
      import_source = 'legacy-localstorage-v1'
      and (
        (
          image_path is null
          and import_image_hash is null
        )
        or
        (
          image_path is not null
          and import_image_hash ~ '^[a-f0-9]{64}$'
        )
      )
    )
  );

grant update (import_image_hash)
  on table public.moments to authenticated;

comment on column public.moments.import_image_hash is
  'Server-computed SHA-256 of the validated bytes stored for a legacy imported Moment image.';
