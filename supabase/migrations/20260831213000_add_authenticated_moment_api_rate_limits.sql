create table public.moment_api_rate_limits (
  owner_id text not null,
  bucket text not null,
  window_started_at timestamptz not null,
  request_count integer not null,

  constraint moment_api_rate_limits_pkey primary key (owner_id, bucket),
  constraint moment_api_rate_limits_owner_id_not_blank check (
    owner_id = btrim(owner_id)
    and char_length(owner_id) between 1 and 255
  ),
  constraint moment_api_rate_limits_bucket_allowed check (
    bucket in ('read', 'mutation', 'import')
  ),
  constraint moment_api_rate_limits_request_count_bounded check (
    request_count between 1 and 121
  )
);

comment on table public.moment_api_rate_limits is
  'Private fixed-window counters for authenticated Moment API operation buckets.';
comment on column public.moment_api_rate_limits.owner_id is
  'The Clerk session-token sub claim; never supplied by an API request body or URL.';

alter table public.moment_api_rate_limits enable row level security;

revoke all on table public.moment_api_rate_limits from public;
revoke all on table public.moment_api_rate_limits from anon;
revoke all on table public.moment_api_rate_limits from authenticated;

create function public.consume_moment_api_rate_limit(requested_bucket text)
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

comment on function public.consume_moment_api_rate_limit(text) is
  'Atomically consumes one owner-scoped fixed-window allowance derived from the authenticated Clerk JWT.';

revoke all on function public.consume_moment_api_rate_limit(text) from public;
revoke all on function public.consume_moment_api_rate_limit(text) from anon;
grant execute on function public.consume_moment_api_rate_limit(text) to authenticated;
