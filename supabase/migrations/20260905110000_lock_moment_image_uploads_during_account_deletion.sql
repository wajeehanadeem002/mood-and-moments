create function public.lock_moment_image_upload_for_account_data_deletion()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_owner text := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');
begin
  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_owner, 0)
  );

  return not exists (
    select 1
    from public.account_data_deletion_jobs as job
    where job.owner_id = caller_owner
  );
end;
$$;

comment on function public.lock_moment_image_upload_for_account_data_deletion() is
  'Serializes an authenticated owner Storage INSERT with account deletion and rejects uploads while deletion is active.';

revoke all on function public.lock_moment_image_upload_for_account_data_deletion()
  from public, anon;
grant execute on function public.lock_moment_image_upload_for_account_data_deletion()
  to authenticated;

drop policy if exists "Users can upload an authorized immutable moment image"
on storage.objects;

create policy "Users can upload an authorized immutable moment image"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 2) ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 3) ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.lock_moment_image_upload_for_account_data_deletion()
  and exists (
    select 1
    from public.moments as moment
    where moment.owner_id = (select auth.jwt() ->> 'sub')
      and moment.id::text = split_part(name, '/', 2)
  )
  and exists (
    select 1
    from public.moment_image_cleanup_authorizations as cleanup_auth
    where cleanup_auth.owner_id = (select auth.jwt() ->> 'sub')
      and cleanup_auth.moment_id::text = split_part(name, '/', 2)
      and cleanup_auth.image_path = name
  )
);
