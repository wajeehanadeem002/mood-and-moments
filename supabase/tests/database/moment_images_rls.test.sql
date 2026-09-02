begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

grant insert on table tap_results to anon, authenticated;

select plan(25);

insert into tap_results (test_number, result)
select 1, results_eq(
  $$
    select public, file_size_limit
    from storage.buckets
    where id = 'moment-images'
  $$,
  $$values (false, 1000000::bigint)$$,
  'moment-images remains private with the one-million-byte limit'
);

insert into tap_results (test_number, result)
select 2, results_eq(
  $$
    select allowed_mime_types
    from storage.buckets
    where id = 'moment-images'
  $$,
  $$values (array['image/jpeg', 'image/png', 'image/webp']::text[])$$,
  'moment-images still accepts only JPEG, PNG, and WebP'
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
    '10000000-0000-4000-8000-00000000000a',
    'user_a',
    'User A image moment',
    'A private moment owned by user A.',
    'calm',
    '2026-08-30',
    null
  ),
  (
    '10000000-0000-4000-8000-00000000000b',
    'user_b',
    'User B image moment',
    'A private moment owned by user B.',
    'happy',
    '2026-08-30',
    'user_b/10000000-0000-4000-8000-00000000000b/image'
  );

insert into storage.objects (bucket_id, name, owner_id)
values (
  'moment-images',
  'user_b/10000000-0000-4000-8000-00000000000b/image',
  'user_b'
);

set local role anon;
set local "request.jwt.claims" = '{}';

insert into tap_results (test_number, result)
select 3, results_eq(
  $$
    select count(*)::bigint
    from storage.objects
    where bucket_id = 'moment-images'
  $$,
  $$values (0::bigint)$$,
  'anonymous users cannot read private Moment images'
);

insert into tap_results (test_number, result)
select 4, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'anonymous users cannot upload immutable candidates'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 5, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'an owner cannot upload a candidate before atomic authorization'
);

insert into tap_results (test_number, result)
select 6, results_eq(
  $$
    select outcome
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000a',
      1,
      'user_a/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values ('authorized'::text)$$,
  'an owner can authorize one immutable candidate at the current revision'
);

insert into tap_results (test_number, result)
select 7, lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001',
      'user_a'
    )
  $$,
  'an authorized immutable candidate can be uploaded'
);

insert into tap_results (test_number, result)
select 8, results_eq(
  $$
    select count(*)::bigint
    from storage.objects
    where bucket_id = 'moment-images'
  $$,
  $$values (1::bigint)$$,
  'the owner can select a cleanup-authorized candidate as required by the Storage remove API'
);

insert into tap_results (test_number, result)
select 9, results_eq(
  $$
    select outcome, (moment ->> 'revision')::bigint
    from public.update_moment_if_revision(
      '10000000-0000-4000-8000-00000000000a',
      1,
      'User A image moment',
      'A private moment owned by user A.',
      'calm',
      '2026-08-30',
      'user_a/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001',
      null
    )
  $$,
  $$values ('updated'::text, 2::bigint)$$,
  'the database CAS activates the uploaded generation and increments revision'
);

insert into tap_results (test_number, result)
select 10, results_eq(
  $$
    select name
    from storage.objects
    where bucket_id = 'moment-images'
  $$,
  $$values ('user_a/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001'::text)$$,
  'the owner can read only their active generation'
);

insert into tap_results (test_number, result)
select 11, results_eq(
  $$
    with updated as (
      update storage.objects
      set metadata = '{"mutable":true}'::jsonb
      where bucket_id = 'moment-images'
      returning id
    )
    select count(*)::bigint from updated
  $$,
  $$values (0::bigint)$$,
  'immutable Moment image objects cannot be updated in place'
);

insert into tap_results (test_number, result)
select 12, throws_ok(
  $$
    select *
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000a',
      2,
      'user_b/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'Moment image path is invalid.',
  'the candidate RPC rejects a wrong-owner folder'
);

insert into tap_results (test_number, result)
select 13, results_eq(
  $$
    select outcome
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000d',
      1,
      'user_a/10000000-0000-4000-8000-00000000000d/70000000-0000-4000-8000-000000000002'
    )
  $$,
  $$values ('not_found'::text)$$,
  'a non-existent Moment cannot authorize Storage'
);

insert into tap_results (test_number, result)
select 14, results_eq(
  $$
    select outcome
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000b',
      1,
      'user_a/10000000-0000-4000-8000-00000000000b/70000000-0000-4000-8000-000000000002'
    )
  $$,
  $$values ('not_found'::text)$$,
  'another owner Moment cannot authorize Storage'
);

insert into tap_results (test_number, result)
select 15, throws_ok(
  $$
    select *
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000a',
      2,
      'user_a/10000000-0000-4000-8000-00000000000a/not-a-uuid'
    )
  $$,
  '22023',
  'Moment image path is invalid.',
  'a non-UUID generation is rejected'
);

insert into tap_results (test_number, result)
select 16, throws_ok(
  $$
    select *
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000a',
      2,
      'user_a/10000000-0000-4000-8000-00000000000a/image'
    )
  $$,
  '22023',
  'Moment image path is invalid.',
  'new mutable stable image names are rejected'
);

insert into tap_results (test_number, result)
select 17, throws_ok(
  $$
    select *
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000a',
      2,
      'user_a/10000000-0000-4000-8000-00000000000a'
    )
  $$,
  '22023',
  'Moment image path is invalid.',
  'too few path segments fail closed'
);

insert into tap_results (test_number, result)
select 18, throws_ok(
  $$
    select *
    from public.authorize_moment_image_candidate(
      '10000000-0000-4000-8000-00000000000a',
      2,
      'user_a/10000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002/extra'
    )
  $$,
  '22023',
  'Moment image path is invalid.',
  'too many path segments fail closed'
);

insert into tap_results (test_number, result)
select 19, is(
  (
    select count(*)::integer
    from storage.objects
    where name = 'user_b/10000000-0000-4000-8000-00000000000b/image'
  ),
  0,
  'cross-user image reads remain denied'
);

insert into tap_results (test_number, result)
select 20, results_eq(
  $$
    with updated as (
      update storage.objects
      set metadata = '{"cross_user":true}'::jsonb
      where name = 'user_b/10000000-0000-4000-8000-00000000000b/image'
      returning id
    )
    select count(*)::bigint from updated
  $$,
  $$values (0::bigint)$$,
  'cross-user updates remain denied'
);

reset role;

insert into tap_results (test_number, result)
select 21, results_eq(
  $$
    select count(*)::bigint
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname in (
        'Users can read active or cleanup-authorized moment images',
        'Users can upload an authorized immutable moment image',
        'Users can delete an authorized moment image cleanup'
      )
      and polroles = array[
        (select oid from pg_roles where rolname = 'authenticated')
      ]
  $$,
  $$values (3::bigint)$$,
  'all H6 Storage policies are restricted to authenticated sessions'
);

insert into tap_results (test_number, result)
select 22, results_eq(
  $$
    select count(*)::bigint
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polcmd = 'w'
      and polname like '%moment image%'
  $$,
  $$values (0::bigint)$$,
  'no UPDATE policy permits mutable in-place image replacement'
);

insert into tap_results (test_number, result)
select 23, ok(
  (
    select pg_get_expr(polqual, polrelid) like '%moment_image_cleanup_authorizations%'
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'Users can delete an authorized moment image cleanup'
  ),
  'Storage DELETE is gated by a durable owner-scoped cleanup authorization'
);

insert into tap_results (test_number, result)
select 24, ok(
  (
    select pg_get_expr(polqual, polrelid) like '%moment_image_cleanup_authorizations%'
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'Users can read active or cleanup-authorized moment images'
  ),
  'Storage SELECT permits only active or owner cleanup-authorized paths so SDK removal can succeed'
);

set local role authenticated;
set local "request.jwt.claims" = '{"role":"authenticated"}';

insert into tap_results (test_number, result)
select 25, results_eq(
  $$
    select count(*)::bigint
    from storage.objects
    where bucket_id = 'moment-images'
  $$,
  $$values (0::bigint)$$,
  'an authenticated role without Clerk sub fails closed'
);

reset role;

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
