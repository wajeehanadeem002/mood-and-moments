begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

create temporary table deletion_operations (
  owner_id text primary key,
  operation_id uuid not null
) on commit drop;

grant insert, select on table tap_results to anon, authenticated;
grant insert, select on table deletion_operations to authenticated;

select plan(28);

insert into tap_results (test_number, result)
select 1, has_table(
  'public',
  'account_data_deletion_jobs',
  'the private account data deletion job table exists'
);

insert into tap_results (test_number, result)
select 2, ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.account_data_deletion_jobs'::regclass
  ),
  'row-level security is enabled on deletion jobs'
);

insert into tap_results (test_number, result)
select 3, has_function(
  'public',
  'begin_account_data_deletion',
  array[]::text[],
  'the database-first authenticated deletion RPC exists'
);

insert into tap_results (test_number, result)
select 4, has_function(
  'public',
  'verify_and_finish_account_data_deletion',
  array['uuid'],
  'the final zero-state verification RPC exists'
);

insert into tap_results (test_number, result)
select 5, ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.begin_account_data_deletion()'::regprocedure
  ),
  'database-first deletion uses a tightly scoped security-definer boundary'
);

insert into tap_results (test_number, result)
select 6, ok(
  not has_table_privilege(
    'authenticated',
    'public.account_data_deletion_jobs',
    'select'
  ),
  'authenticated callers cannot inspect private deletion job state'
);

insert into tap_results (test_number, result)
select 7, ok(
  not has_function_privilege(
    'anon',
    'public.begin_account_data_deletion()',
    'execute'
  ),
  'anonymous callers cannot execute account deletion'
);

insert into tap_results (test_number, result)
select 8, ok(
  has_function_privilege(
    'authenticated',
    'public.begin_account_data_deletion()',
    'execute'
  ),
  'authenticated callers may execute the owner-derived deletion RPC'
);

insert into public.moments (
  id,
  owner_id,
  title,
  description,
  mood,
  moment_date,
  image_path
)
values
  (
    '71000000-0000-4000-8000-000000000001',
    'delete_test_user_a',
    'Owner A with image',
    'Owned cloud data slated for deletion.',
    'calm',
    '2026-09-05',
    'delete_test_user_a/71000000-0000-4000-8000-000000000001/image'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    'delete_test_user_a',
    'Owner A text only',
    'A second owned Moment.',
    'happy',
    '2026-09-05',
    null
  ),
  (
    '72000000-0000-4000-8000-000000000001',
    'delete_test_user_b',
    'Owner B remains',
    'Another account must not be affected.',
    'loved',
    '2026-09-05',
    null
  );

insert into storage.objects (bucket_id, name, owner_id)
values
  (
    'moment-images',
    'delete_test_user_a/71000000-0000-4000-8000-000000000001/image',
    'delete_test_user_a'
  ),
  (
    'moment-images',
    'delete_test_user_a/73000000-0000-4000-8000-000000000001/73100000-0000-4000-8000-000000000001',
    'delete_test_user_a'
  );

set local role anon;
set local "request.jwt.claims" = '{}';

insert into tap_results (test_number, result)
select 9, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'permission denied for function begin_account_data_deletion',
  'anonymous callers are denied before any deletion work'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{}';

insert into tap_results (test_number, result)
select 10, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Authentication is required.',
  'a role without a Clerk sub fails closed'
);

set local "request.jwt.claims" = '{"sub":"delete_test_user_a","role":"authenticated","fva":[0,-1]}';

insert into deletion_operations (owner_id, operation_id)
select 'delete_test_user_a', operation_id
from public.begin_account_data_deletion();

insert into tap_results (test_number, result)
select 11, is(
  (
    select count(*)::bigint
    from public.moments
  ),
  0::bigint,
  'owner A can no longer read any Moments after database-first deletion'
);

reset role;

insert into tap_results (test_number, result)
select 12, is(
  (
    select count(*)::integer
    from public.moments
    where owner_id = 'delete_test_user_a'
  ),
  0,
  'database-first deletion removes all and only owner A Moments'
);

insert into tap_results (test_number, result)
select 13, is(
  (
    select count(*)::integer
    from public.moments
    where owner_id = 'delete_test_user_b'
  ),
  1,
  'another Clerk owner Moment remains untouched'
);

insert into tap_results (test_number, result)
select 14, is(
  (
    select count(*)::integer
    from public.account_data_deletion_jobs
    where owner_id = 'delete_test_user_a'
      and status = 'cleanup_pending'
  ),
  1,
  'one durable owner job remains while Storage cleanup is pending'
);

insert into tap_results (test_number, result)
select 15, is(
  (
    select count(*)::integer
    from public.moment_image_cleanup_authorizations
    where owner_id = 'delete_test_user_a'
  ),
  2,
  'active and recoverable owner image objects receive durable cleanup authorization'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"delete_test_user_a","role":"authenticated","fva":[0,-1]}';

insert into tap_results (test_number, result)
select 16, throws_ok(
  $$select * from public.account_data_deletion_jobs$$,
  '42501',
  'permission denied for table account_data_deletion_jobs',
  'the owner cannot directly read or mutate deletion jobs'
);

insert into tap_results (test_number, result)
select 17, throws_ok(
  $$
    insert into public.moments (title, description, mood, moment_date)
    values ('Race insert', 'Must be blocked while cleanup is pending.', 'calm', '2026-09-05')
  $$,
  '55000',
  'Account cloud data deletion is in progress.',
  'new Moment creation is blocked while the durable deletion job is pending'
);

insert into tap_results (test_number, result)
select 18, results_eq(
  format(
    $query$
      select outcome, remaining_moments, remaining_storage_objects,
        remaining_cleanup_authorizations, remaining_deletion_jobs
      from public.verify_and_finish_account_data_deletion(%L::uuid)
    $query$,
    (select operation_id from deletion_operations where owner_id = 'delete_test_user_a')
  ),
  $$values ('incomplete'::text, 0, 2, 2, 1)$$,
  'finalization fails closed while objects and authorizations remain'
);

insert into tap_results (test_number, result)
select 19, throws_ok(
  $$
    select * from public.verify_and_finish_account_data_deletion(
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )
  $$,
  '22023',
  'Deletion operation is invalid.',
  'an old or client-manufactured operation cannot replace the active job'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"delete_test_user_b","role":"authenticated","fva":[0,-1]}';

insert into tap_results (test_number, result)
select 20, is(
  (
    select count(*)::bigint
    from public.moment_image_cleanup_authorizations
  ),
  0::bigint,
  'another Clerk owner cannot see owner A cleanup authorizations'
);

insert into deletion_operations (owner_id, operation_id)
select 'delete_test_user_b', operation_id
from public.begin_account_data_deletion();

insert into tap_results (test_number, result)
select 21, is(
  (
    select count(*)::bigint
    from public.moments
  ),
  0::bigint,
  'owner B can independently delete only their remaining data'
);

insert into tap_results (test_number, result)
select 22, results_eq(
  format(
    $query$
      select outcome, remaining_moments, remaining_storage_objects,
        remaining_cleanup_authorizations, remaining_deletion_jobs
      from public.verify_and_finish_account_data_deletion(%L::uuid)
    $query$,
    (select operation_id from deletion_operations where owner_id = 'delete_test_user_b')
  ),
  $$values ('complete'::text, 0, 0, 0, 0)$$,
  'owner B finalizes an independent zero-state job'
);

set local "request.jwt.claims" = '{"sub":"delete_test_user_c","role":"authenticated","fva":[0,-1]}';

insert into deletion_operations (owner_id, operation_id)
select 'delete_test_user_c', operation_id
from public.begin_account_data_deletion();

insert into tap_results (test_number, result)
select 23, results_eq(
  format(
    $query$
      select outcome, remaining_moments, remaining_storage_objects,
        remaining_cleanup_authorizations, remaining_deletion_jobs
      from public.verify_and_finish_account_data_deletion(%L::uuid)
    $query$,
    (select operation_id from deletion_operations where owner_id = 'delete_test_user_c')
  ),
  $$values ('complete'::text, 0, 0, 0, 0)$$,
  'empty and repeated account deletion remains idempotent'
);

reset role;

insert into tap_results (test_number, result)
select 24, is(
  (
    select count(*)::integer
    from public.moment_api_rate_limits
    where owner_id in ('delete_test_user_a', 'delete_test_user_b')
  ),
  0,
  'cloud data deletion does not erase or manufacture operational counters'
);

insert into tap_results (test_number, result)
select 25, is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'moment-images'
      and split_part(name, '/', 1) in ('delete_test_user_a', 'delete_test_user_b')
  ),
  2,
  'failed or deferred Storage cleanup leaves owner A objects for authenticated API retry'
);

insert into tap_results (test_number, result)
select 26, is(
  (
    select count(*)::integer
    from public.moment_image_cleanup_authorizations
    where owner_id in ('delete_test_user_a', 'delete_test_user_b')
  ),
  2,
  'failed or deferred Storage cleanup leaves durable owner A authorizations'
);

insert into tap_results (test_number, result)
select 27, is(
  (
    select count(*)::integer
    from public.account_data_deletion_jobs
    where owner_id in ('delete_test_user_a', 'delete_test_user_b')
  ),
  1,
  'incomplete owner A cleanup retains exactly one durable deletion job'
);

insert into tap_results (test_number, result)
select 28, is(
  (
    select count(*)::integer
    from public.account_data_deletion_jobs
    where owner_id in ('delete_test_user_b', 'delete_test_user_c')
  ),
  0,
  'verified zero-state owners retain no deletion jobs'
);

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
