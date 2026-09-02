begin;

create extension if not exists pgtap with schema extensions;

create temporary table tap_results (
  test_number integer primary key,
  result text not null
) on commit drop;

grant insert on table tap_results to authenticated;

select plan(25);

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
    '60000000-0000-4000-8000-00000000000a',
    'user_a',
    'Original A',
    'The first owner snapshot.',
    'calm',
    '2026-09-01'
  ),
  (
    '60000000-0000-4000-8000-00000000000b',
    'user_b',
    'Original B',
    'A different owner snapshot.',
    'happy',
    '2026-09-01'
  );

insert into tap_results (test_number, result)
select 1, is(
  (
    select revision
    from public.moments
    where id = '60000000-0000-4000-8000-00000000000a'
  ),
  1::bigint,
  'existing and newly-created Moments start at revision one'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"user_a","role":"authenticated"}';

insert into tap_results (test_number, result)
select 2, throws_ok(
  $$
    update public.moments
    set revision = 99
    where id = '60000000-0000-4000-8000-00000000000a'
  $$,
  '42501',
  null,
  'authenticated callers cannot directly update revision'
);

insert into tap_results (test_number, result)
select 21, throws_ok(
  $$
    update public.moments
    set title = 'Bypassed CAS'
    where id = '60000000-0000-4000-8000-00000000000a'
  $$,
  '42501',
  null,
  'authenticated callers cannot bypass CAS with a direct row update'
);

insert into tap_results (test_number, result)
select 22, throws_ok(
  $$
    delete from public.moments
    where id = '60000000-0000-4000-8000-00000000000a'
  $$,
  '42501',
  null,
  'authenticated callers cannot bypass CAS and cleanup with direct delete'
);

insert into tap_results (test_number, result)
select 23, throws_ok(
  $$
    insert into public.moments (
      title,
      description,
      mood,
      moment_date,
      image_path
    )
    values (
      'Unsafe image row',
      'Image paths require the server lifecycle.',
      'calm',
      '2026-09-01',
      'user_a/60000000-0000-4000-8000-00000000000a/image'
    )
  $$,
  '42501',
  null,
  'authenticated callers cannot create a row with a client-provided image path'
);

insert into tap_results (test_number, result)
select 3, results_eq(
  $$
    select outcome, (moment ->> 'revision')::bigint
    from public.update_moment_if_revision(
      '60000000-0000-4000-8000-00000000000a',
      1,
      'Updated A',
      'The winning owner update.',
      'loved',
      '2026-09-02',
      null,
      null
    )
  $$,
  $$values ('updated'::text, 2::bigint)$$,
  'a current owner revision updates once and returns the next revision'
);

insert into tap_results (test_number, result)
select 4, results_eq(
  $$
    select outcome, (moment ->> 'revision')::bigint
    from public.update_moment_if_revision(
      '60000000-0000-4000-8000-00000000000a',
      1,
      'Stale overwrite',
      'This must not win.',
      'angry',
      '2026-09-03',
      null,
      null
    )
  $$,
  $$values ('conflict'::text, 2::bigint)$$,
  'a stale update returns the current revision without mutating the row'
);

insert into tap_results (test_number, result)
select 5, is(
  (
    select title
    from public.moments
    where id = '60000000-0000-4000-8000-00000000000a'
  ),
  'Updated A',
  'the stale writer cannot overwrite the winning title'
);

insert into tap_results (test_number, result)
select 6, results_eq(
  $$
    select outcome
    from public.update_moment_if_revision(
      '60000000-0000-4000-8000-00000000000b',
      1,
      'Cross-owner overwrite',
      'This must remain hidden.',
      'sad',
      '2026-09-03',
      null,
      null
    )
  $$,
  $$values ('not_found'::text)$$,
  'a different owner receives the same not-found outcome as a missing Moment'
);

insert into tap_results (test_number, result)
select 7, results_eq(
  $$
    select outcome
    from public.authorize_moment_image_candidate(
      '60000000-0000-4000-8000-00000000000a',
      2,
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values ('authorized'::text)$$,
  'the owner can authorize one immutable image generation at the current revision'
);

insert into tap_results (test_number, result)
select 8, is(
  (
    select count(*)::integer
    from public.moment_image_cleanup_authorizations
    where image_path = 'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001'
  ),
  1,
  'the candidate has durable owner-scoped cleanup authorization before upload'
);

insert into tap_results (test_number, result)
select 9, results_eq(
  $$
    select outcome
    from public.authorize_moment_image_candidate(
      '60000000-0000-4000-8000-00000000000a',
      1,
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002'
    )
  $$,
  $$values ('conflict'::text)$$,
  'a stale image candidate is rejected before Storage is touched'
);

insert into tap_results (test_number, result)
select 10, results_eq(
  $$
    select outcome
    from public.authorize_moment_image_candidate(
      '60000000-0000-4000-8000-00000000000a',
      2,
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002'
    )
  $$,
  $$values ('authorized'::text)$$,
  'two image candidates may prepare independently at the same current revision'
);

insert into tap_results (test_number, result)
select 11, lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values
      (
        'moment-images',
        'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001',
        'user_a'
      ),
      (
        'moment-images',
        'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002',
        'user_a'
      )
  $$,
  'both separately authorized immutable candidates can upload'
);

insert into tap_results (test_number, result)
select 12, results_eq(
  $$
    select outcome, (moment ->> 'revision')::bigint
    from public.update_moment_if_revision(
      '60000000-0000-4000-8000-00000000000a',
      2,
      'Image A winner',
      'The first image candidate wins.',
      'loved',
      '2026-09-02',
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001',
      null
    )
  $$,
  $$values ('updated'::text, 3::bigint)$$,
  'image A wins one atomic row-and-path CAS'
);

insert into tap_results (test_number, result)
select 13, results_eq(
  $$
    select outcome, (moment ->> 'revision')::bigint
    from public.update_moment_if_revision(
      '60000000-0000-4000-8000-00000000000a',
      2,
      'Image B loser',
      'The losing candidate cannot overwrite image A.',
      'sad',
      '2026-09-03',
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002',
      null
    )
  $$,
  $$values ('conflict'::text, 3::bigint)$$,
  'image B loses the same revision CAS and receives the winner revision'
);

insert into tap_results (test_number, result)
select 14, is(
  (
    select image_path
    from public.moments
    where id = '60000000-0000-4000-8000-00000000000a'
  ),
  'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001',
  'the stored path corresponds exactly to the winning image object'
);

insert into tap_results (test_number, result)
select 15, is(
  (
    select count(*)::integer
    from public.moment_image_cleanup_authorizations
    where image_path = 'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002'
  ),
  1,
  'the losing request retains authorization to clean only image B'
);

insert into tap_results (test_number, result)
select 24, throws_ok(
  $$
    select *
    from public.authorize_moment_image_candidate(
      '60000000-0000-4000-8000-00000000000a',
      3,
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'Moment image candidate is not available.',
  'the active image generation cannot be re-authorized for cleanup'
);

insert into tap_results (test_number, result)
select 25, throws_ok(
  $$
    select *
    from public.authorize_moment_image_candidate(
      '60000000-0000-4000-8000-00000000000a',
      3,
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'Moment image candidate is not available.',
  'an existing inactive generation cannot be re-authorized as a new candidate'
);

insert into tap_results (test_number, result)
select 16, results_eq(
  $$
    select outcome, (moment ->> 'revision')::bigint
    from public.delete_moment_if_revision(
      '60000000-0000-4000-8000-00000000000a',
      1
    )
  $$,
  $$values ('conflict'::text, 3::bigint)$$,
  'a stale delete preserves the newer Moment'
);

insert into tap_results (test_number, result)
select 17, results_eq(
  $$
    select outcome
    from public.delete_moment_if_revision(
      '60000000-0000-4000-8000-00000000000a',
      3
    )
  $$,
  $$values ('deleted'::text)$$,
  'a current delete removes the owner Moment'
);

insert into tap_results (test_number, result)
select 18, results_eq(
  $$
    select outcome
    from public.delete_moment_if_revision(
      '60000000-0000-4000-8000-00000000000a',
      3
    )
  $$,
  $$values ('not_found'::text)$$,
  'a concurrent second delete observes the missing Moment'
);

set local "request.jwt.claims" = '{"sub":"user_b","role":"authenticated"}';

insert into tap_results (test_number, result)
select 19, is(
  (
    select count(*)::integer
    from public.moment_image_cleanup_authorizations
  ),
  0,
  'another Clerk user cannot read cleanup authorization metadata'
);

insert into tap_results (test_number, result)
select 20, results_eq(
  $$
    select outcome
    from public.complete_moment_image_cleanup(
      'user_a/60000000-0000-4000-8000-00000000000a/70000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values ('not_found'::text)$$,
  'another Clerk user cannot complete the owner cleanup authorization'
);

reset role;

reset role;

insert into tap_results (test_number, result)
select 999, finish();

select test_number, result
from tap_results
order by test_number;

rollback;
