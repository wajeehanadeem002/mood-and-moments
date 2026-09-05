create table public.account_data_deletion_jobs (
  owner_id text primary key,
  operation_id uuid not null default gen_random_uuid() unique,
  status text not null default 'cleanup_pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_data_deletion_owner_not_blank check (
    owner_id = btrim(owner_id)
    and char_length(owner_id) between 1 and 255
  ),
  constraint account_data_deletion_status_allowed check (
    status = 'cleanup_pending'
  )
);

comment on table public.account_data_deletion_jobs is
  'Private durable state for authenticated owner-scoped cloud data deletion cleanup.';
comment on column public.account_data_deletion_jobs.owner_id is
  'The Clerk session-token sub claim; never supplied by an API request.';

alter table public.account_data_deletion_jobs enable row level security;
revoke all on table public.account_data_deletion_jobs from public, anon, authenticated;

create function public.guard_moment_insert_during_account_data_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');
begin
  if caller_owner is null
    or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
    or new.owner_id is distinct from caller_owner
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_owner, 0));

  if exists (
    select 1
    from public.account_data_deletion_jobs as job
    where job.owner_id = caller_owner
  ) then
    raise object_not_in_prerequisite_state using
      message = 'Account cloud data deletion is in progress.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_moment_insert_during_account_data_deletion()
  from public, anon, authenticated;

create trigger moments_guard_account_data_deletion
before insert on public.moments
for each row
execute function public.guard_moment_insert_during_account_data_deletion();

create function public.begin_account_data_deletion()
returns table (
  operation_id uuid,
  deleted_moments integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');
  current_operation_id uuid;
  removed_count integer;
  invalid_object_count integer;
begin
  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_owner, 0));

  insert into public.account_data_deletion_jobs as job (owner_id)
  values (caller_owner)
  on conflict (owner_id) do update
  set updated_at = statement_timestamp()
  returning job.operation_id into current_operation_id;

  select count(*)::integer
  into invalid_object_count
  from storage.objects as object
  where object.bucket_id = 'moment-images'
    and split_part(object.name, '/', 1) = caller_owner
    and (
      cardinality(string_to_array(object.name, '/')) <> 3
      or split_part(object.name, '/', 2) !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (
        split_part(object.name, '/', 3) <> 'image'
        and split_part(object.name, '/', 3) !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    );

  if invalid_object_count <> 0 then
    raise data_exception using message = 'Account image cleanup metadata is invalid.';
  end if;

  insert into public.moment_image_cleanup_authorizations (
    image_path,
    owner_id,
    moment_id
  )
  select
    object.name,
    caller_owner,
    split_part(object.name, '/', 2)::uuid
  from storage.objects as object
  where object.bucket_id = 'moment-images'
    and split_part(object.name, '/', 1) = caller_owner
  on conflict (image_path) do nothing;

  insert into public.moment_image_cleanup_authorizations (
    image_path,
    owner_id,
    moment_id
  )
  select moment.image_path, caller_owner, moment.id
  from public.moments as moment
  where moment.owner_id = caller_owner
    and moment.image_path is not null
  on conflict (image_path) do nothing;

  delete from public.moments as moment
  where moment.owner_id = caller_owner;
  get diagnostics removed_count = row_count;

  return query select current_operation_id, removed_count;
end;
$$;

create function public.verify_and_finish_account_data_deletion(
  requested_operation_id uuid
)
returns table (
  outcome text,
  remaining_moments integer,
  remaining_storage_objects integer,
  remaining_cleanup_authorizations integer,
  remaining_deletion_jobs integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');
  active_operation_id uuid;
  moment_count integer;
  object_count integer;
  cleanup_count integer;
begin
  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  if requested_operation_id is null then
    raise invalid_parameter_value using message = 'Deletion operation is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_owner, 0));

  select job.operation_id
  into active_operation_id
  from public.account_data_deletion_jobs as job
  where job.owner_id = caller_owner
  for update;

  if active_operation_id is not null
    and active_operation_id is distinct from requested_operation_id
  then
    raise invalid_parameter_value using message = 'Deletion operation is invalid.';
  end if;

  select count(*)::integer into moment_count
  from public.moments as moment
  where moment.owner_id = caller_owner;

  select count(*)::integer into object_count
  from storage.objects as object
  where object.bucket_id = 'moment-images'
    and split_part(object.name, '/', 1) = caller_owner;

  select count(*)::integer into cleanup_count
  from public.moment_image_cleanup_authorizations as cleanup
  where cleanup.owner_id = caller_owner;

  if moment_count = 0 and object_count = 0 and cleanup_count = 0 then
    delete from public.account_data_deletion_jobs as job
    where job.owner_id = caller_owner
      and job.operation_id = requested_operation_id;

    return query values ('complete'::text, 0, 0, 0, 0);
  else
    return query values (
      'incomplete'::text,
      moment_count,
      object_count,
      cleanup_count,
      case when active_operation_id is null then 0 else 1 end
    );
  end if;
end;
$$;

revoke all on function public.begin_account_data_deletion()
  from public, anon;
revoke all on function public.verify_and_finish_account_data_deletion(uuid)
  from public, anon;
grant execute on function public.begin_account_data_deletion()
  to authenticated;
grant execute on function public.verify_and_finish_account_data_deletion(uuid)
  to authenticated;

alter table public.moment_api_rate_limits
  drop constraint moment_api_rate_limits_bucket_allowed;

alter table public.moment_api_rate_limits
  add constraint moment_api_rate_limits_bucket_allowed check (
    bucket in ('read', 'mutation', 'import', 'export', 'delete-data')
  );

create or replace function public.consume_moment_api_rate_limit(requested_bucket text)
returns table (
  allowed boolean,
  limit_value integer,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id text := auth.jwt() ->> 'sub';
  current_jwt_role text := auth.jwt() ->> 'role';
  bucket_limit integer;
  current_time_at timestamptz := statement_timestamp();
  stored_window_started_at timestamptz;
  stored_request_count integer;
begin
  if current_jwt_role is distinct from 'authenticated'
    or coalesce(btrim(current_owner_id), '') = '' then
    raise exception using
      errcode = '42501',
      message = 'An authenticated Clerk subject is required.';
  end if;

  bucket_limit := case requested_bucket
    when 'read' then 120
    when 'mutation' then 30
    when 'import' then 10
    when 'export' then 2
    when 'delete-data' then 2
    else null
  end;

  if bucket_limit is null then
    raise exception using
      errcode = '22023',
      message = 'Unsupported Moment API rate-limit bucket.';
  end if;

  insert into public.moment_api_rate_limits as current_window (
    owner_id,
    bucket,
    window_started_at,
    request_count
  )
  values (current_owner_id, requested_bucket, current_time_at, 1)
  on conflict (owner_id, bucket) do update
  set
    window_started_at = case
      when current_window.window_started_at <= current_time_at - interval '60 seconds'
        then current_time_at
      else current_window.window_started_at
    end,
    request_count = case
      when current_window.window_started_at <= current_time_at - interval '60 seconds'
        then 1
      else least(current_window.request_count + 1, bucket_limit + 1)
    end
  returning current_window.window_started_at, current_window.request_count
  into stored_window_started_at, stored_request_count;

  return query values (
    stored_request_count <= bucket_limit,
    bucket_limit,
    greatest(bucket_limit - stored_request_count, 0),
    greatest(
      1,
      least(
        60,
        ceil(extract(epoch from (
          stored_window_started_at + interval '60 seconds' - current_time_at
        )))::integer
      )
    )
  );
end;
$$;

comment on function public.begin_account_data_deletion() is
  'Creates or resumes an authenticated owner deletion job, authorizes image cleanup, and deletes only that owner moments atomically.';
comment on function public.verify_and_finish_account_data_deletion(uuid) is
  'Finishes an authenticated owner deletion job only after Moments, private objects, and cleanup authorizations are all absent.';
comment on function public.consume_moment_api_rate_limit(text) is
  'Atomically consumes one owner-scoped fixed-window allowance derived from the authenticated Clerk JWT.';
comment on table public.moment_api_rate_limits is
  'Private fixed-window counters for authenticated Moment API and account actions.';
