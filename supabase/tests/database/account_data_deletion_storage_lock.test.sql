begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

grant insert, select on table tap_results to authenticated;

select plan(8);

insert into tap_results (test_number, result)
select 1, has_function(
  'public',
  'lock_moment_image_upload_for_account_data_deletion',
  array[]::text[],
  'the Storage INSERT owner-lock guard exists'
);

insert into tap_results (test_number, result)
select 2, ok(
  coalesce(
    (
      select procedure.prosecdef
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'lock_moment_image_upload_for_account_data_deletion'
        and procedure.pronargs = 0
    ),
    false
  ),
  'the owner-lock guard uses a controlled security-definer boundary'
);

insert into tap_results (test_number, result)
select 3, ok(
  coalesce(
    (
      select has_function_privilege('authenticated', procedure.oid, 'execute')
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'lock_moment_image_upload_for_account_data_deletion'
        and procedure.pronargs = 0
    ),
    false
  ),
  'authenticated Storage INSERT policy evaluation can execute the guard'
);

insert into tap_results (test_number, result)
select 4, ok(
  coalesce(
    (
      select pg_get_expr(policy.polwithcheck, policy.polrelid) like
        '%lock_moment_image_upload_for_account_data_deletion%'
      from pg_policy as policy
      where policy.polrelid = 'storage.objects'::regclass
        and policy.polname = 'Users can upload an authorized immutable moment image'
        and policy.polcmd = 'a'
    ),
    false
  ),
  'the immutable Storage INSERT policy invokes the owner-lock guard'
);

insert into public.moments (
  id,
  owner_id,
  title,
  description,
  mood,
  moment_date
)
values
  (
    '75000000-0000-4000-8000-000000000001',
    'delete_storage_lock_user',
    'Storage lock fixture',
    'An authorized upload used by the deletion lock test.',
    'calm',
    '2026-09-05'
  ),
  (
    '75000000-0000-4000-8000-000000000002',
    'delete_storage_other_user',
    'Independent Storage fixture',
    'Another owner must keep an independent lock domain.',
    'happy',
    '2026-09-05'
  );

insert into public.moment_image_cleanup_authorizations (
  image_path,
  owner_id,
  moment_id
)
values
  (
    'delete_storage_lock_user/75000000-0000-4000-8000-000000000001/75100000-0000-4000-8000-000000000001',
    'delete_storage_lock_user',
    '75000000-0000-4000-8000-000000000001'
  ),
  (
    'delete_storage_lock_user/75000000-0000-4000-8000-000000000001/75100000-0000-4000-8000-000000000002',
    'delete_storage_lock_user',
    '75000000-0000-4000-8000-000000000001'
  ),
  (
    'delete_storage_other_user/75000000-0000-4000-8000-000000000002/75200000-0000-4000-8000-000000000001',
    'delete_storage_other_user',
    '75000000-0000-4000-8000-000000000002'
  );

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"delete_storage_lock_user","role":"authenticated"}';

insert into tap_results (test_number, result)
select 5, lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'delete_storage_lock_user/75000000-0000-4000-8000-000000000001/75100000-0000-4000-8000-000000000001',
      'delete_storage_lock_user'
    )
  $$,
  'an authorized upload remains valid when no deletion job exists'
);

reset role;

insert into public.account_data_deletion_jobs (owner_id)
values ('delete_storage_lock_user');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"delete_storage_lock_user","role":"authenticated"}';

insert into tap_results (test_number, result)
select 6, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'delete_storage_lock_user/75000000-0000-4000-8000-000000000001/75100000-0000-4000-8000-000000000002',
      'delete_storage_lock_user'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'an active account deletion job rejects a previously authorized upload'
);

set local "request.jwt.claims" =
  '{"sub":"delete_storage_other_user","role":"authenticated"}';

insert into tap_results (test_number, result)
select 7, lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'delete_storage_other_user/75000000-0000-4000-8000-000000000002/75200000-0000-4000-8000-000000000001',
      'delete_storage_other_user'
    )
  $$,
  'another owner without a deletion job retains an independent upload path'
);

reset role;

insert into tap_results (test_number, result)
select 8, is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'moment-images'
      and split_part(name, '/', 1) in (
        'delete_storage_lock_user',
        'delete_storage_other_user'
      )
  ),
  2,
  'only uploads outside an active same-owner deletion job become visible'
);

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
