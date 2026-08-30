alter table public.moments
  drop constraint moments_import_image_hash_complete;

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
          and import_image_hash is not null
          and import_image_hash ~ '^[a-f0-9]{64}$'
        )
      )
    )
  );
