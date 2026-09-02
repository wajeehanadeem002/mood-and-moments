begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

grant insert on table tap_results to anon, authenticated;

select plan(43);

insert into tap_results (test_number, result)
select 1, has_table('public', 'moments', 'moments table exists');

insert into tap_results (test_number, result)
select 2, ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.moments'::regclass
  ),
  'row-level security is enabled on moments'
);

insert into tap_results (test_number, result)
select 3, has_index(
  'public',
  'moments',
  'moments_owner_timeline_idx',
  'owner timeline index exists'
);

insert into public.moments (
  id,
  owner_id,
  title,
  description,
  mood,
  moment_date,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-00000000000a',
    'user_a',
    'User A moment',
    'A private moment owned by user A.',
    'calm',
    '2026-08-28',
    '2026-08-28T09:00:00Z',
    '2026-08-28T09:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-00000000000b',
    'user_b',
    'User B moment',
    'A private moment owned by user B.',
    'happy',
    '2026-08-27',
    '2026-08-27T09:00:00Z',
    '2026-08-27T09:00:00Z'
  );

set local role anon;

insert into tap_results (test_number, result)
select 4, throws_ok(
  $$select * from public.moments$$,
  '42501',
  'permission denied for table moments',
  'anonymous users cannot read moments'
);

insert into tap_results (test_number, result)
select 5, throws_ok(
  $$
    insert into public.moments (title, description, mood, moment_date)
    values ('Anonymous', 'Must not be stored.', 'calm', '2026-08-29')
  $$,
  '42501',
  'permission denied for table moments',
  'anonymous users cannot insert moments'
);

insert into tap_results (test_number, result)
select 6, throws_ok(
  $$
    update public.moments
    set title = 'Anonymous update'
    where id = '00000000-0000-0000-0000-00000000000a'
  $$,
  '42501',
  'permission denied for table moments',
  'anonymous users cannot update moments'
);

insert into tap_results (test_number, result)
select 7, throws_ok(
  $$
    delete from public.moments
    where id = '00000000-0000-0000-0000-00000000000a'
  $$,
  '42501',
  'permission denied for table moments',
  'anonymous users cannot delete moments'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 8, results_eq(
  $$
    select id
    from public.moments
    order by id
  $$,
  $$values ('00000000-0000-0000-0000-00000000000a'::uuid)$$,
  'user A can read their own moments'
);

insert into tap_results (test_number, result)
select 9, is(
  (
    select count(*)::integer
    from public.moments
    where id = '00000000-0000-0000-0000-00000000000b'
  ),
  0,
  'user A cannot read user B moments'
);

insert into tap_results (test_number, result)
select 10, lives_ok(
  $$
    insert into public.moments (title, description, mood, moment_date)
    values ('JWT-owned moment', 'Ownership comes from Clerk sub.', 'loved', '2026-08-29')
  $$,
  'user A can insert a moment without supplying owner_id'
);

insert into tap_results (test_number, result)
select 11, is(
  (
    select owner_id
    from public.moments
    where title = 'JWT-owned moment'
  ),
  'user_a',
  'new moments default owner_id from the Clerk sub claim'
);

insert into tap_results (test_number, result)
select 12, results_eq(
  $$
    select outcome
    from public.update_moment_if_revision(
      '00000000-0000-0000-0000-00000000000b',
      1,
      'Compromised title',
      'A private moment owned by user B.',
      'happy',
      '2026-08-27',
      null,
      null
    )
  $$,
  $$values ('not_found'::text)$$,
  'user A cannot update user B moments'
);

insert into tap_results (test_number, result)
select 13, results_eq(
  $$
    select outcome
    from public.update_moment_if_revision(
      '00000000-0000-0000-0000-00000000000a',
      1,
      'User A updated moment',
      'A private moment owned by user A.',
      'calm',
      '2026-08-28',
      null,
      null
    )
  $$,
  $$values ('updated'::text)$$,
  'user A can update their own moment'
);

insert into tap_results (test_number, result)
select 14, ok(
  (
    select updated_at > created_at
      and revision = 2
    from public.moments
    where id = '00000000-0000-0000-0000-00000000000a'
  ),
  'updates advance updated_at automatically'
);

reset role;
grant update (owner_id) on public.moments to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 15, throws_ok(
  $$
    update public.moments
    set owner_id = 'user_b'
    where id = '00000000-0000-0000-0000-00000000000a'
  $$,
  '42501',
  'new row violates row-level security policy for table "moments"',
  'the update policy prevents ownership transfer even if column access is granted'
);

insert into tap_results (test_number, result)
select 16, results_eq(
  $$
    select outcome
    from public.delete_moment_if_revision(
      '00000000-0000-0000-0000-00000000000b',
      1
    )
  $$,
  $$values ('not_found'::text)$$,
  'user A cannot delete user B moments'
);

insert into tap_results (test_number, result)
select 17, results_eq(
  $$
    select outcome
    from public.delete_moment_if_revision(
      (select id from public.moments where title = 'JWT-owned moment'),
      (select revision from public.moments where title = 'JWT-owned moment')
    )
  $$,
  $$values ('deleted'::text)$$,
  'user A can delete their own moment'
);

reset role;

insert into tap_results (test_number, result)
select 18, is(
  (
    select title
    from public.moments
    where id = '00000000-0000-0000-0000-00000000000b'
  ),
  'User B moment',
  'user B moment remains unchanged after user A attempts mutations'
);

insert into tap_results (test_number, result)
select 19, has_column(
  'public',
  'moments',
  'moment_time',
  'moments preserve imported local display time'
);

insert into tap_results (test_number, result)
select 20, has_column(
  'public',
  'moments',
  'import_source',
  'moments record an import source discriminator'
);

insert into tap_results (test_number, result)
select 21, has_column(
  'public',
  'moments',
  'import_source_id',
  'moments record an owner-scoped import source id'
);

insert into tap_results (test_number, result)
select 22, has_column(
  'public',
  'moments',
  'import_source_hash',
  'moments record a normalized import source hash'
);

insert into tap_results (test_number, result)
select 23, has_index(
  'public',
  'moments',
  'moments_owner_import_source_idx',
  'owner-scoped import idempotency index exists'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 24, lives_ok(
  $$
    insert into public.moments (
      title,
      description,
      mood,
      moment_date,
      moment_time,
      import_source,
      import_source_id,
      import_source_hash
    )
    values (
      'Imported A moment',
      'Imported explicitly from browser-local storage.',
      'calm',
      '2026-08-25',
      '17:42:19',
      'legacy-localstorage-v1',
      'shared-local-id',
      repeat('a', 64)
    )
  $$,
  'user A can insert a complete imported moment without supplying ownership'
);

insert into tap_results (test_number, result)
select 25, is(
  (
    select owner_id
    from public.moments
    where import_source_id = 'shared-local-id'
  ),
  'user_a',
  'imported moments derive owner_id from the Clerk sub claim'
);

insert into tap_results (test_number, result)
select 26, is(
  (
    select moment_time::text
    from public.moments
    where import_source_id = 'shared-local-id'
  ),
  '17:42:19',
  'imported moments preserve their original displayed time'
);

insert into tap_results (test_number, result)
select 27, throws_ok(
  $$
    insert into public.moments (
      title,
      description,
      mood,
      moment_date,
      moment_time,
      import_source,
      import_source_id,
      import_source_hash
    )
    values (
      'Duplicate imported A moment',
      'A retry must not create a duplicate row.',
      'calm',
      '2026-08-25',
      '17:42:19',
      'legacy-localstorage-v1',
      'shared-local-id',
      repeat('a', 64)
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "moments_owner_import_source_idx"',
  'the same owner cannot import the same source id twice'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_b","role":"authenticated"}';

insert into tap_results (test_number, result)
select 28, lives_ok(
  $$
    insert into public.moments (
      title,
      description,
      mood,
      moment_date,
      moment_time,
      import_source,
      import_source_id,
      import_source_hash
    )
    values (
      'Imported B moment',
      'The same browser id is independent for a different owner.',
      'loved',
      '2026-08-25',
      '17:42:19',
      'legacy-localstorage-v1',
      'shared-local-id',
      repeat('b', 64)
    )
  $$,
  'a different owner may use the same legacy source id'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 29, is(
  (
    select count(*)::integer
    from public.moments
    where title = 'Imported B moment'
  ),
  0,
  'user A cannot read user B imported moments'
);

insert into tap_results (test_number, result)
select 30, throws_ok(
  $$
    update public.moments
    set import_source_id = 'transferred-source-id'
    where import_source_id = 'shared-local-id'
  $$,
  '42501',
  'permission denied for table moments',
  'authenticated users cannot mutate durable import identity metadata'
);

insert into tap_results (test_number, result)
select 31, throws_ok(
  $$
    insert into public.moments (
      title,
      description,
      mood,
      moment_date,
      import_source,
      import_source_id,
      import_source_hash
    )
    values (
      'Incomplete imported moment',
      'Import metadata must be complete.',
      'calm',
      '2026-08-25',
      'legacy-localstorage-v1',
      'incomplete-source-id',
      repeat('c', 64)
    )
  $$,
  '23514',
  'new row for relation "moments" violates check constraint "moments_import_metadata_complete"',
  'partial import metadata is rejected'
);

insert into tap_results (test_number, result)
select 32, ok(
  (
    select moment_time is null
      and import_source is null
      and import_source_id is null
      and import_source_hash is null
    from public.moments
    where id = '00000000-0000-0000-0000-00000000000a'
  ),
  'ordinary cloud moments keep their existing created_at time fallback metadata'
);

reset role;

insert into tap_results (test_number, result)
select 33, has_column(
  'public',
  'moments',
  'import_image_hash',
  'moments record the digest of imported image bytes'
);

insert into tap_results (test_number, result)
select 34, ok(
  (
    select import_image_hash is null
    from public.moments
    where id = '00000000-0000-0000-0000-00000000000a'
  ),
  'ordinary cloud moments remain valid without an import image digest'
);

-- These transaction-local grants exercise the existing import-image integrity
-- constraints directly. Production writes remain restricted to the H6 CAS RPC.
grant update (image_path, import_image_hash) on public.moments to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 35, lives_ok(
  $$
    update public.moments
    set
      image_path = owner_id || '/' || id::text || '/image',
      import_image_hash = repeat('d', 64)
    where import_source_id = 'shared-local-id'
  $$,
  'an owner can atomically link an imported image and its byte digest'
);

insert into tap_results (test_number, result)
select 36, is(
  (
    select import_image_hash
    from public.moments
    where import_source_id = 'shared-local-id'
  ),
  repeat('d', 64),
  'the imported image digest is stored exactly'
);

insert into tap_results (test_number, result)
select 37, throws_ok(
  $$
    update public.moments
    set import_image_hash = 'caller-manufactured'
    where import_source_id = 'shared-local-id'
  $$,
  '23514',
  'new row for relation "moments" violates check constraint "moments_import_image_hash_complete"',
  'malformed image digests are rejected'
);

insert into tap_results (test_number, result)
select 38, throws_ok(
  $$
    update public.moments
    set import_image_hash = null
    where import_source_id = 'shared-local-id'
  $$,
  '23514',
  'new row for relation "moments" violates check constraint "moments_import_image_hash_complete"',
  'an imported image path cannot exist without its digest'
);

insert into tap_results (test_number, result)
select 39, throws_ok(
  $$
    update public.moments
    set image_path = null
    where import_source_id = 'shared-local-id'
  $$,
  '23514',
  'new row for relation "moments" violates check constraint "moments_import_image_hash_complete"',
  'an imported image digest cannot exist without its image path'
);

insert into tap_results (test_number, result)
select 40, throws_ok(
  $$
    update public.moments
    set import_image_hash = repeat('e', 64)
    where id = '00000000-0000-0000-0000-00000000000a'
  $$,
  '23514',
  'new row for relation "moments" violates check constraint "moments_import_image_hash_complete"',
  'ordinary cloud moments cannot manufacture legacy image metadata'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_b","role":"authenticated"}';

insert into tap_results (test_number, result)
select 41, is(
  (
    select count(*)::integer
    from public.moments
    where title = 'Imported A moment'
      and import_image_hash is not null
  ),
  0,
  'another Clerk user cannot read imported image metadata'
);

insert into tap_results (test_number, result)
select 42, results_eq(
  $$
    with updated as (
      update public.moments
      set import_image_hash = repeat('e', 64)
      where title = 'Imported A moment'
      returning id
    )
    select count(*)::bigint from updated
  $$,
  $$values (0::bigint)$$,
  'another Clerk user cannot modify imported image metadata'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 43, lives_ok(
  $$
    update public.moments
    set image_path = null, import_image_hash = null
    where import_source_id = 'shared-local-id'
  $$,
  'an owner can atomically remove an imported image and its digest'
);

reset role;

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
