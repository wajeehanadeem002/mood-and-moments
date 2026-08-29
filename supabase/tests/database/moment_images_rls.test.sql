begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

grant insert on table tap_results to anon, authenticated;

select plan(8);

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

insert into storage.objects (bucket_id, name, owner_id)
values
  ('moment-images', 'user_a/moment-a/image-a.webp', 'user_a'),
  ('moment-images', 'user_b/moment-b/image-b.webp', 'user_b');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 3, lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values ('moment-images', 'user_a/moment-c/image-c.png', 'user_a')
  $$,
  'user A can create an object inside their own folder'
);

insert into tap_results (test_number, result)
select 4, throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values ('moment-images', 'user_b/moment-c/image-c.png', 'user_a')
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'user A cannot create an object inside user B folder'
);

insert into tap_results (test_number, result)
select 5, results_eq(
  $$
    select name
    from storage.objects
    where bucket_id = 'moment-images'
    order by name
  $$,
  $$
    values
      ('user_a/moment-a/image-a.webp'::text),
      ('user_a/moment-c/image-c.png'::text)
  $$,
  'user A can read only objects in their own folder'
);

insert into tap_results (test_number, result)
select 6, lives_ok(
  $$
    update storage.objects
    set name = 'user_a/moment-a/image'
    where bucket_id = 'moment-images'
      and name = 'user_a/moment-a/image-a.webp'
  $$,
  'user A can replace an object while keeping it inside their own folder'
);

insert into tap_results (test_number, result)
select 7, results_eq(
  $$
    with updated as (
      update storage.objects
      set name = 'user_b/moment-b/compromised.webp'
      where bucket_id = 'moment-images'
        and name = 'user_b/moment-b/image-b.webp'
      returning id
    )
    select count(*)::bigint from updated
  $$,
  $$values (0::bigint)$$,
  'user A cannot update user B objects'
);

insert into tap_results (test_number, result)
select 8, throws_ok(
  $$
    update storage.objects
    set name = 'user_b/moment-a/image'
    where bucket_id = 'moment-images'
      and name = 'user_a/moment-a/image'
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'the update WITH CHECK prevents moving an owned object into user B folder'
);

reset role;

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
