begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

grant insert on table tap_results to anon, authenticated;

select plan(25);

insert into tap_results (test_number, result)
select 1, has_table(
  'public',
  'moment_api_rate_limits',
  'the private Moment API rate-limit table exists'
);

insert into tap_results (test_number, result)
select 2, ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.moment_api_rate_limits'::regclass
  ),
  'row-level security is enabled on the rate-limit table'
);

insert into tap_results (test_number, result)
select 3, has_function(
  'public',
  'consume_moment_api_rate_limit',
  array['text'],
  'the authenticated rate-limit RPC exists'
);

insert into tap_results (test_number, result)
select 4, ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.consume_moment_api_rate_limit(text)'::regprocedure
  ),
  'the RPC is security definer so callers never receive table access'
);

insert into tap_results (test_number, result)
select 5, ok(
  not has_function_privilege(
    'anon',
    'public.consume_moment_api_rate_limit(text)',
    'execute'
  ),
  'anonymous users cannot execute the rate-limit RPC'
);

insert into tap_results (test_number, result)
select 6, ok(
  has_function_privilege(
    'authenticated',
    'public.consume_moment_api_rate_limit(text)',
    'execute'
  ),
  'authenticated users can execute the rate-limit RPC'
);

set local role anon;
set local "request.jwt.claims" = '{}';

insert into tap_results (test_number, result)
select 7, throws_ok(
  $$select * from public.moment_api_rate_limits$$,
  '42501',
  'permission denied for table moment_api_rate_limits',
  'anonymous users cannot read rate-limit state'
);

insert into tap_results (test_number, result)
select 8, throws_ok(
  $$select * from public.consume_moment_api_rate_limit('read')$$,
  '42501',
  'permission denied for function consume_moment_api_rate_limit',
  'anonymous requests cannot consume a rate-limit allowance'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{}';

insert into tap_results (test_number, result)
select 9, throws_ok(
  $$select * from public.moment_api_rate_limits$$,
  '42501',
  'permission denied for table moment_api_rate_limits',
  'authenticated users cannot read private rate-limit state directly'
);

insert into tap_results (test_number, result)
select 10, throws_ok(
  $$select * from public.consume_moment_api_rate_limit('read')$$,
  '42501',
  'An authenticated Clerk subject is required.',
  'an authenticated role without a Clerk sub fails closed'
);

set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 11, throws_ok(
  $$select * from public.consume_moment_api_rate_limit('unknown')$$,
  '22023',
  'Unsupported Moment API rate-limit bucket.',
  'callers cannot manufacture additional operation buckets'
);

insert into tap_results (test_number, result)
select 12, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('read')
  $$,
  $$values (true, 120, 119)$$,
  'user A receives the first read allowance from the 120-request bucket'
);

insert into tap_results (test_number, result)
select 13, lives_ok(
  $test$
    do $block$
    begin
      for request_number in 1..119 loop
        perform * from public.consume_moment_api_rate_limit('read');
      end loop;
    end
    $block$
  $test$,
  'the remaining read requests through the exact limit are accepted'
);

insert into tap_results (test_number, result)
select 14, results_eq(
  $$
    select allowed, limit_value, remaining,
      retry_after_seconds between 1 and 60
    from public.consume_moment_api_rate_limit('read')
  $$,
  $$values (false, 120, 0, true)$$,
  'the request after the read boundary is denied with bounded retry metadata'
);

reset role;

insert into tap_results (test_number, result)
select 15, is(
  (
    select request_count
    from public.moment_api_rate_limits
    where owner_id = 'user_a' and bucket = 'read'
  ),
  121,
  'denied requests use a bounded overflow marker instead of growing forever'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_b","role":"authenticated"}';

insert into tap_results (test_number, result)
select 16, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('read')
  $$,
  $$values (true, 120, 119)$$,
  'user B has an independent read bucket'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 17, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('mutation')
  $$,
  $$values (true, 30, 29)$$,
  'user A mutations use an independent 30-request bucket'
);

insert into tap_results (test_number, result)
select 18, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('import')
  $$,
  $$values (true, 10, 9)$$,
  'user A imports use an independent 10-request bucket'
);

reset role;

insert into tap_results (test_number, result)
select 19, results_eq(
  $$
    select owner_id, bucket
    from public.moment_api_rate_limits
    order by owner_id, bucket
  $$,
  $$
    values
      ('user_a', 'import'),
      ('user_a', 'mutation'),
      ('user_a', 'read'),
      ('user_b', 'read')
  $$,
  'counter ownership comes only from each authenticated Clerk sub'
);

update public.moment_api_rate_limits
set
  window_started_at = statement_timestamp() - interval '61 seconds',
  request_count = 121
where owner_id = 'user_a' and bucket = 'read';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 20, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('read')
  $$,
  $$values (true, 120, 119)$$,
  'an expired fixed window is safely reclaimed'
);

insert into tap_results (test_number, result)
select 21, throws_ok(
  $$
    update public.moment_api_rate_limits
    set request_count = 1
    where owner_id = 'user_a'
  $$,
  '42501',
  'permission denied for table moment_api_rate_limits',
  'authenticated users cannot reset or alter counters directly'
);

reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 22, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('export')
  $$,
  $$values (true, 2, 1)$$,
  'user A receives the first export allowance from the two-request bucket'
);

insert into tap_results (test_number, result)
select 23, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('export')
  $$,
  $$values (true, 2, 0)$$,
  'user A receives the second and final export allowance'
);

insert into tap_results (test_number, result)
select 24, results_eq(
  $$
    select allowed, limit_value, remaining,
      retry_after_seconds between 1 and 60
    from public.consume_moment_api_rate_limit('export')
  $$,
  $$values (false, 2, 0, true)$$,
  'a third export is denied with bounded retry metadata'
);

set local "request.jwt.claims" = '{"sub":"user_b","role":"authenticated"}';

insert into tap_results (test_number, result)
select 25, results_eq(
  $$
    select allowed, limit_value, remaining
    from public.consume_moment_api_rate_limit('export')
  $$,
  $$values (true, 2, 1)$$,
  'another Clerk subject has an independent export allowance'
);

reset role;

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
