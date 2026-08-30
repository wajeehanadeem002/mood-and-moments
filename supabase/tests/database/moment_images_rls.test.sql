begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

grant insert on table tap_results to anon, authenticated;

select plan(24);

insert into tap_results (test_number, result)
select 1, results_eq(
  $$
    select public, file_size_limit
    from storage.buckets
    where id = 'moment-images'
  $$,
  $$values (false, 1000000::bigint)$$,
  'moment-images is a private bucket with a one-million-byte limit'
);

insert into tap_results (test_number, result)
select 2, results_eq(
  $$
    select allowed_mime_types
    from storage.buckets
    where id = 'moment-images'
  $$,
  $$values (array['image/jpeg', 'image/png', 'image/webp']::text[])$$,
  'moment-images accepts only JPEG, PNG, and WebP files'
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
    '10000000-0000-4000-8000-00000000000a',
    'user_a',
    'User A image moment',
    'A private moment owned by user A.',
    'calm',
    '2026-08-30'
  ),
  (
    '10000000-0000-4000-8000-00000000000b',
    'user_b',
    'User B image moment',
    'A private moment owned by user B.',
    'happy',
    '2026-08-30'
  ),
  (
    '10000000-0000-4000-8000-00000000000c',
    'user_a',
    'User A second image moment',
    'Another private moment owned by user A.',
    'loved',
    '2026-08-30'
  );

insert into storage.objects (bucket_id, name, owner_id)
values
  (
    'moment-images',
    'user_a/10000000-0000-4000-8000-00000000000a/image',
    'user_a'
  ),
  (
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
  'anonymous users cannot read moment images'
);

insert into tap_results (test_number, result)
select 4, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000c/image',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'anonymous users cannot insert moment images'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 5, lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000c/image',
      'user_a'
    )
  $$,
  'user A can insert the exact canonical path for their own Moment'
);

insert into tap_results (test_number, result)
select 6, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_b/10000000-0000-4000-8000-00000000000a/image',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'user A cannot insert into a wrong-owner folder'
);

insert into tap_results (test_number, result)
select 7, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000d/image',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'user A cannot insert an image for a non-existent Moment'
);

insert into tap_results (test_number, result)
select 8, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000b/image',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'user A cannot insert an image for a Moment owned by user B'
);

insert into tap_results (test_number, result)
select 9, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values ('moment-images', 'user_a/not-a-uuid/image', 'user_a')
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'an invalid UUID path segment is denied without being cast'
);

insert into tap_results (test_number, result)
select 10, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000a/thumbnail',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a final path segment other than image is denied'
);

insert into tap_results (test_number, result)
select 11, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000a',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a path with too few segments is denied'
);

insert into tap_results (test_number, result)
select 12, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'moment-images',
      'user_a/10000000-0000-4000-8000-00000000000a/image/extra',
      'user_a'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a path with too many segments is denied'
);

insert into tap_results (test_number, result)
select 13, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values ('moment-images', 'user_a/arbitrary-object', 'user_a')
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'arbitrary object names under the authenticated user folder are denied'
);

insert into tap_results (test_number, result)
select 14, results_eq(
  $$
    select name
    from storage.objects
    where bucket_id = 'moment-images'
    order by name
  $$,
  $$
    values
      ('user_a/10000000-0000-4000-8000-00000000000a/image'::text),
      ('user_a/10000000-0000-4000-8000-00000000000c/image'::text)
  $$,
  'user A can select only canonical images for their own Moments'
);

insert into tap_results (test_number, result)
select 15, is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'moment-images'
      and name = 'user_b/10000000-0000-4000-8000-00000000000b/image'
  ),
  0,
  'user A cannot select user B images'
);

insert into tap_results (test_number, result)
select 16, lives_ok(
  $$
    update storage.objects
    set metadata = '{"hardened":true}'::jsonb
    where bucket_id = 'moment-images'
      and name = 'user_a/10000000-0000-4000-8000-00000000000a/image'
  $$,
  'user A can update their own canonical Moment image'
);

insert into tap_results (test_number, result)
select 17, results_eq(
  $$
    with updated as (
      update storage.objects
      set metadata = '{"compromised":true}'::jsonb
      where bucket_id = 'moment-images'
        and name = 'user_b/10000000-0000-4000-8000-00000000000b/image'
      returning id
    )
    select count(*)::bigint from updated
  $$,
  $$values (0::bigint)$$,
  'user A cannot update user B images'
);

insert into tap_results (test_number, result)
select 18, throws_ok(
  $$
    update storage.objects
    set name = 'user_a/10000000-0000-4000-8000-00000000000a/not-image'
    where bucket_id = 'moment-images'
      and name = 'user_a/10000000-0000-4000-8000-00000000000a/image'
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'the update WITH CHECK prevents moving an owned image to a non-canonical path'
);

reset role;

insert into tap_results (test_number, result)
select 19, results_eq(
  $$
    select pg_get_expr(delete_policy.polqual, delete_policy.polrelid)
    from pg_policy as delete_policy
    where delete_policy.polrelid = 'storage.objects'::regclass
      and delete_policy.polname = 'Users can delete their own moment images'
  $$,
  $$
    select pg_get_expr(select_policy.polqual, select_policy.polrelid)
    from pg_policy as select_policy
    where select_policy.polrelid = 'storage.objects'::regclass
      and select_policy.polname = 'Users can read their own moment images'
  $$,
  'DELETE uses the same verified owner-and-Moment path predicate as SELECT'
);

insert into tap_results (test_number, result)
select 20, results_eq(
  $$
    select pg_get_expr(update_policy.polqual, update_policy.polrelid)
    from pg_policy as update_policy
    where update_policy.polrelid = 'storage.objects'::regclass
      and update_policy.polname = 'Users can replace their own moment images'
  $$,
  $$
    select pg_get_expr(select_policy.polqual, select_policy.polrelid)
    from pg_policy as select_policy
    where select_policy.polrelid = 'storage.objects'::regclass
      and select_policy.polname = 'Users can read their own moment images'
  $$,
  'UPDATE USING applies the same owner-and-Moment path predicate as SELECT and DELETE'
);

insert into tap_results (test_number, result)
select 21, results_eq(
  $$
    select pg_get_expr(update_policy.polwithcheck, update_policy.polrelid)
    from pg_policy as update_policy
    where update_policy.polrelid = 'storage.objects'::regclass
      and update_policy.polname = 'Users can replace their own moment images'
  $$,
  $$
    select pg_get_expr(insert_policy.polwithcheck, insert_policy.polrelid)
    from pg_policy as insert_policy
    where insert_policy.polrelid = 'storage.objects'::regclass
      and insert_policy.polname = 'Users can upload their own moment images'
  $$,
  'UPDATE WITH CHECK applies the same canonical-path predicate as INSERT'
);

insert into tap_results (test_number, result)
select 22, results_eq(
  $$
    select pg_get_expr(select_policy.polqual, select_policy.polrelid)
    from pg_policy as select_policy
    where select_policy.polrelid = 'storage.objects'::regclass
      and select_policy.polname = 'Users can read their own moment images'
  $$,
  $$
    select pg_get_expr(insert_policy.polwithcheck, insert_policy.polrelid)
    from pg_policy as insert_policy
    where insert_policy.polrelid = 'storage.objects'::regclass
      and insert_policy.polname = 'Users can upload their own moment images'
  $$,
  'SELECT, INSERT, UPDATE, and DELETE all use the same canonical-path predicate'
);

insert into tap_results (test_number, result)
select 23, results_eq(
  $$
    select count(*)::bigint
    from pg_policy as policy
    where policy.polrelid = 'storage.objects'::regclass
      and policy.polname in (
        'Users can read their own moment images',
        'Users can upload their own moment images',
        'Users can replace their own moment images',
        'Users can delete their own moment images'
      )
      and policy.polroles = array[
        (select oid from pg_roles where rolname = 'authenticated')
      ]
  $$,
  $$values (4::bigint)$$,
  'all moment-images lifecycle policies are restricted to authenticated sessions'
);

set local role authenticated;
set local "request.jwt.claims" = '{"role":"authenticated"}';

insert into tap_results (test_number, result)
select 24, results_eq(
  $$
    select count(*)::bigint
    from storage.objects
    where bucket_id = 'moment-images'
  $$,
  $$values (0::bigint)$$,
  'an authenticated role without a Clerk sub claim fails closed'
);

reset role;

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
