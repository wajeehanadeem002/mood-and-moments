alter table public.moment_api_rate_limits
  drop constraint moment_api_rate_limits_bucket_allowed;

alter table public.moment_api_rate_limits
  add constraint moment_api_rate_limits_bucket_allowed check (
    bucket in ('read', 'mutation', 'import', 'export')
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
  values (
    current_owner_id,
    requested_bucket,
    current_time_at,
    1
  )
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
  returning
    current_window.window_started_at,
    current_window.request_count
  into stored_window_started_at, stored_request_count;

  return query
  values (
    stored_request_count <= bucket_limit,
    bucket_limit,
    greatest(bucket_limit - stored_request_count, 0),
    greatest(
      1,
      least(
        60,
        ceil(
          extract(
            epoch from (
              stored_window_started_at + interval '60 seconds' - current_time_at
            )
          )
        )::integer
      )
    )
  );
end;
$$;

comment on table public.moment_api_rate_limits is
  'Private fixed-window counters for authenticated Moment API and account-export operation buckets.';

comment on function public.consume_moment_api_rate_limit(text) is
  'Atomically consumes one owner-scoped fixed-window allowance derived from the authenticated Clerk JWT.';
