alter table public.moments
  add column revision bigint not null default 1;

alter table public.moments
  add constraint moments_revision_positive check (revision >= 1);

comment on column public.moments.revision is
  'Database-controlled monotonic revision used for authenticated optimistic concurrency.';

revoke delete on table public.moments from authenticated;
revoke insert (image_path) on table public.moments from authenticated;
revoke update (
  title,
  description,
  mood,
  moment_date,
  image_path,
  import_image_hash
) on table public.moments from authenticated;

create or replace function public.set_moments_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  new.revision = old.revision + 1;
  return new;
end;
$$;

revoke all on function public.set_moments_updated_at() from public;

create table public.moment_image_cleanup_authorizations (
  image_path text primary key,
  owner_id text not null,
  moment_id uuid not null,
  created_at timestamptz not null default now(),

  constraint moment_image_cleanup_owner_not_blank check (
    owner_id = btrim(owner_id)
    and char_length(owner_id) between 1 and 255
  ),
  constraint moment_image_cleanup_path_matches_owner check (
    cardinality(string_to_array(image_path, '/')) = 3
    and split_part(image_path, '/', 1) = owner_id
    and split_part(image_path, '/', 2) = moment_id::text
    and (
      split_part(image_path, '/', 3) = 'image'
      or split_part(image_path, '/', 3) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  )
);

comment on table public.moment_image_cleanup_authorizations is
  'Owner-scoped durable authorization for deleting an immutable or legacy private Moment image after a database mutation.';

alter table public.moment_image_cleanup_authorizations enable row level security;

revoke all on table public.moment_image_cleanup_authorizations from anon;
revoke all on table public.moment_image_cleanup_authorizations from authenticated;
grant select on table public.moment_image_cleanup_authorizations to authenticated;

create policy "Users can read their own moment image cleanup authorizations"
on public.moment_image_cleanup_authorizations
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and owner_id = (select auth.jwt() ->> 'sub')
);

create function public.authorize_moment_image_candidate(
  requested_moment_id uuid,
  requested_revision bigint,
  requested_image_path text
)
returns table (
  outcome text,
  moment jsonb,
  cleanup_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text;
  current_moment public.moments%rowtype;
begin
  caller_owner := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');

  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  if requested_revision is null or requested_revision < 1 then
    raise invalid_parameter_value using message = 'Moment revision is invalid.';
  end if;

  select owned.*
  into current_moment
  from public.moments as owned
  where owned.id = requested_moment_id
    and owned.owner_id = caller_owner
  for update;

  if not found then
    return query select 'not_found'::text, null::jsonb, null::text;
    return;
  end if;

  if current_moment.revision <> requested_revision then
    return query
      select 'conflict'::text, to_jsonb(current_moment), null::text;
    return;
  end if;

  if requested_image_path is null
    or requested_image_path <> caller_owner || '/' || requested_moment_id::text || '/' || split_part(requested_image_path, '/', 3)
    or cardinality(string_to_array(requested_image_path, '/')) <> 3
    or split_part(requested_image_path, '/', 3) !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise invalid_parameter_value using message = 'Moment image path is invalid.';
  end if;

  if requested_image_path = current_moment.image_path
    or exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'moment-images'
        and object.name = requested_image_path
    )
  then
    raise invalid_parameter_value using message = 'Moment image candidate is not available.';
  end if;

  insert into public.moment_image_cleanup_authorizations (
    image_path,
    owner_id,
    moment_id
  )
  values (requested_image_path, caller_owner, requested_moment_id)
  on conflict (image_path) do nothing;

  if not found then
    raise invalid_parameter_value using message = 'Moment image candidate is not available.';
  end if;

  return query
    select 'authorized'::text, to_jsonb(current_moment), requested_image_path;
end;
$$;

create function public.update_moment_if_revision(
  requested_moment_id uuid,
  requested_revision bigint,
  requested_title text,
  requested_description text,
  requested_mood text,
  requested_moment_date date,
  requested_image_path text,
  requested_import_image_hash text
)
returns table (
  outcome text,
  moment jsonb,
  cleanup_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text;
  current_moment public.moments%rowtype;
  updated_moment public.moments%rowtype;
  previous_image_path text;
begin
  caller_owner := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');

  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  if requested_revision is null or requested_revision < 1 then
    raise invalid_parameter_value using message = 'Moment revision is invalid.';
  end if;

  select owned.*
  into current_moment
  from public.moments as owned
  where owned.id = requested_moment_id
    and owned.owner_id = caller_owner
  for update;

  if not found then
    return query select 'not_found'::text, null::jsonb, null::text;
    return;
  end if;

  if current_moment.revision <> requested_revision then
    return query
      select 'conflict'::text, to_jsonb(current_moment), null::text;
    return;
  end if;

  if requested_image_path is distinct from current_moment.image_path
    and requested_image_path is not null
  then
    if requested_image_path <> caller_owner || '/' || requested_moment_id::text || '/' || split_part(requested_image_path, '/', 3)
      or cardinality(string_to_array(requested_image_path, '/')) <> 3
      or split_part(requested_image_path, '/', 3) !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not exists (
        select 1
        from public.moment_image_cleanup_authorizations as cleanup_auth
        where cleanup_auth.owner_id = caller_owner
          and cleanup_auth.moment_id = requested_moment_id
          and cleanup_auth.image_path = requested_image_path
      )
      or not exists (
        select 1
        from storage.objects as object
        where object.bucket_id = 'moment-images'
          and object.name = requested_image_path
      )
    then
      raise invalid_parameter_value using message = 'Moment image candidate is not available.';
    end if;
  end if;

  previous_image_path := case
    when requested_image_path is distinct from current_moment.image_path
      then current_moment.image_path
    else null
  end;

  if previous_image_path is not null then
    insert into public.moment_image_cleanup_authorizations (
      image_path,
      owner_id,
      moment_id
    )
    values (previous_image_path, caller_owner, requested_moment_id)
    on conflict (image_path) do nothing;
  end if;

  update public.moments as owned
  set
    title = requested_title,
    description = requested_description,
    mood = requested_mood,
    moment_date = requested_moment_date,
    image_path = requested_image_path,
    import_image_hash = requested_import_image_hash
  where owned.id = requested_moment_id
    and owned.owner_id = caller_owner
  returning owned.* into updated_moment;

  if requested_image_path is distinct from current_moment.image_path
    and requested_image_path is not null
  then
    delete from public.moment_image_cleanup_authorizations as cleanup_auth
    where cleanup_auth.image_path = requested_image_path
      and cleanup_auth.owner_id = caller_owner;
  end if;

  return query
    select 'updated'::text, to_jsonb(updated_moment), previous_image_path;
end;
$$;

create function public.delete_moment_if_revision(
  requested_moment_id uuid,
  requested_revision bigint
)
returns table (
  outcome text,
  moment jsonb,
  cleanup_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text;
  current_moment public.moments%rowtype;
begin
  caller_owner := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');

  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  if requested_revision is null or requested_revision < 1 then
    raise invalid_parameter_value using message = 'Moment revision is invalid.';
  end if;

  select owned.*
  into current_moment
  from public.moments as owned
  where owned.id = requested_moment_id
    and owned.owner_id = caller_owner
  for update;

  if not found then
    return query select 'not_found'::text, null::jsonb, null::text;
    return;
  end if;

  if current_moment.revision <> requested_revision then
    return query
      select 'conflict'::text, to_jsonb(current_moment), null::text;
    return;
  end if;

  if current_moment.image_path is not null then
    insert into public.moment_image_cleanup_authorizations (
      image_path,
      owner_id,
      moment_id
    )
    values (current_moment.image_path, caller_owner, requested_moment_id)
    on conflict (image_path) do nothing;
  end if;

  delete from public.moments as owned
  where owned.id = requested_moment_id
    and owned.owner_id = caller_owner;

  return query
    select 'deleted'::text, to_jsonb(current_moment), current_moment.image_path;
end;
$$;

create function public.complete_moment_image_cleanup(
  requested_image_path text
)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text;
begin
  caller_owner := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');

  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.moment_image_cleanup_authorizations as cleanup_auth
    where cleanup_auth.image_path = requested_image_path
      and cleanup_auth.owner_id = caller_owner
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  if exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'moment-images'
      and object.name = requested_image_path
  ) then
    return query select 'object_present'::text;
    return;
  end if;

  delete from public.moment_image_cleanup_authorizations as cleanup_auth
  where cleanup_auth.image_path = requested_image_path
    and cleanup_auth.owner_id = caller_owner;

  if found then
    return query select 'completed'::text;
  else
    return query select 'not_found'::text;
  end if;
end;
$$;

revoke all on function public.authorize_moment_image_candidate(uuid, bigint, text)
  from public, anon;
revoke all on function public.update_moment_if_revision(
  uuid,
  bigint,
  text,
  text,
  text,
  date,
  text,
  text
) from public, anon;
revoke all on function public.delete_moment_if_revision(uuid, bigint)
  from public, anon;
revoke all on function public.complete_moment_image_cleanup(text)
  from public, anon;

grant execute on function public.authorize_moment_image_candidate(uuid, bigint, text)
  to authenticated;
grant execute on function public.update_moment_if_revision(
  uuid,
  bigint,
  text,
  text,
  text,
  date,
  text,
  text
) to authenticated;
grant execute on function public.delete_moment_if_revision(uuid, bigint)
  to authenticated;
grant execute on function public.complete_moment_image_cleanup(text)
  to authenticated;

drop policy if exists "Users can read their own moment images"
on storage.objects;
drop policy if exists "Users can upload their own moment images"
on storage.objects;
drop policy if exists "Users can replace their own moment images"
on storage.objects;
drop policy if exists "Users can delete their own moment images"
on storage.objects;

create policy "Users can read active or cleanup-authorized moment images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 2) ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    split_part(name, '/', 3) = 'image'
    or split_part(name, '/', 3) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  and (
    exists (
      select 1
      from public.moments as moment
      where moment.owner_id = (select auth.jwt() ->> 'sub')
        and moment.id::text = split_part(name, '/', 2)
        and moment.image_path = name
    )
    or exists (
      select 1
      from public.moment_image_cleanup_authorizations as cleanup_auth
      where cleanup_auth.owner_id = (select auth.jwt() ->> 'sub')
        and cleanup_auth.moment_id::text = split_part(name, '/', 2)
        and cleanup_auth.image_path = name
    )
  )
);

create policy "Users can upload an authorized immutable moment image"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 2) ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 3) ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.moments as moment
    where moment.owner_id = (select auth.jwt() ->> 'sub')
      and moment.id::text = split_part(name, '/', 2)
  )
  and exists (
    select 1
    from public.moment_image_cleanup_authorizations as cleanup_auth
    where cleanup_auth.owner_id = (select auth.jwt() ->> 'sub')
      and cleanup_auth.moment_id::text = split_part(name, '/', 2)
      and cleanup_auth.image_path = name
  )
);

create policy "Users can delete an authorized moment image cleanup"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 2) ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    split_part(name, '/', 3) = 'image'
    or split_part(name, '/', 3) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  and exists (
    select 1
    from public.moment_image_cleanup_authorizations as cleanup_auth
    where cleanup_auth.owner_id = (select auth.jwt() ->> 'sub')
      and cleanup_auth.moment_id::text = split_part(name, '/', 2)
      and cleanup_auth.image_path = name
  )
);
