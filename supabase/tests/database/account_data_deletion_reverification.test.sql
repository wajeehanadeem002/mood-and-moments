begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

create temporary table deletion_operation (
  operation_id uuid primary key
) on commit drop;

grant insert, select on table tap_results to authenticated;
grant insert, select on table deletion_operation to authenticated;

select plan(17);

insert into tap_results (test_number, result)
select 1, has_function(
  'public',
  'clerk_session_has_strict_reverification',
  array[]::text[],
  'the fail-closed Clerk strict-reverification validator exists'
);

insert into tap_results (test_number, result)
select 2, has_function(
  'public',
  'begin_account_data_deletion_without_reverification',
  array[]::text[],
  'the privileged deletion implementation is isolated behind its wrapper'
);

insert into tap_results (test_number, result)
select 3, has_function(
  'public',
  'verify_and_finish_account_data_deletion_without_reverification',
  array['uuid'],
  'the privileged finalizer implementation is isolated behind its wrapper'
);

insert into tap_results (test_number, result)
select 4, ok(
  not coalesce(
    (
      select has_function_privilege('authenticated', procedure.oid, 'execute')
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'begin_account_data_deletion_without_reverification'
        and procedure.pronargs = 0
    ),
    true
  ),
  'authenticated callers cannot invoke the unguarded deletion implementation'
);

insert into tap_results (test_number, result)
select 5, ok(
  not coalesce(
    (
      select has_function_privilege('authenticated', procedure.oid, 'execute')
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'verify_and_finish_account_data_deletion_without_reverification'
        and procedure.pronargs = 1
    ),
    true
  ),
  'authenticated callers cannot invoke the unguarded finalizer implementation'
);

set local role authenticated;

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated"}';
insert into tap_results (test_number, result)
select 6, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'a missing fva claim fails closed'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":"0,-1"}';
insert into tap_results (test_number, result)
select 7, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'a non-array fva claim fails closed'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[0]}';
insert into tap_results (test_number, result)
select 8, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'an fva array with the wrong length fails closed'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[null,0]}';
insert into tap_results (test_number, result)
select 9, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'an fva array with malformed entries fails closed'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[-2,-1]}';
insert into tap_results (test_number, result)
select 10, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'an invalid negative factor age fails closed'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[-1,-1]}';
insert into tap_results (test_number, result)
select 11, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'a session with neither verified factor fails closed'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[10,-1]}';
insert into tap_results (test_number, result)
select 12, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'a fallback first factor at the ten-minute boundary is stale'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[0,10]}';
insert into tap_results (test_number, result)
select 13, throws_ok(
  $$select * from public.begin_account_data_deletion()$$,
  '42501',
  'Strict Clerk reverification is required.',
  'an applicable second factor at the ten-minute boundary is stale'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[9.999,-1]}';
insert into deletion_operation (operation_id)
select operation_id from public.begin_account_data_deletion();

insert into tap_results (test_number, result)
select 14, is(
  (select count(*)::integer from deletion_operation),
  1,
  'a fresh first factor is accepted when no second factor applies'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[100,9.999]}';
insert into tap_results (test_number, result)
select 15, results_eq(
  $$select operation_id from public.begin_account_data_deletion()$$,
  $$select operation_id from deletion_operation$$,
  'a fresh applicable second factor is accepted even when the first factor is stale'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated"}';
insert into tap_results (test_number, result)
select 16, throws_ok(
  format(
    $$select * from public.verify_and_finish_account_data_deletion(%L::uuid)$$,
    (select operation_id from deletion_operation)
  ),
  '42501',
  'Strict Clerk reverification is required.',
  'the finalization RPC independently rejects a missing fva claim'
);

set local "request.jwt.claims" = '{"sub":"fva_test_user","role":"authenticated","fva":[100,0]}';
insert into tap_results (test_number, result)
select 17, results_eq(
  format(
    $$
      select outcome, remaining_moments, remaining_storage_objects,
        remaining_cleanup_authorizations, remaining_deletion_jobs
      from public.verify_and_finish_account_data_deletion(%L::uuid)
    $$,
    (select operation_id from deletion_operation)
  ),
  $$values ('complete'::text, 0, 0, 0, 0)$$,
  'a fresh second factor can complete a verified empty deletion job'
);

reset role;

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
