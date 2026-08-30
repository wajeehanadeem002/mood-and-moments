drop policy if exists "Users can read their own moment images"
on storage.objects;

drop policy if exists "Users can upload their own moment images"
on storage.objects;

drop policy if exists "Users can replace their own moment images"
on storage.objects;

drop policy if exists "Users can delete their own moment images"
on storage.objects;

create policy "Users can read their own moment images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 3) = 'image'
  and exists (
    select 1
    from public.moments as moment
    where moment.owner_id = (select auth.jwt() ->> 'sub')
      and moment.id::text = split_part(name, '/', 2)
  )
);

create policy "Users can upload their own moment images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 3) = 'image'
  and exists (
    select 1
    from public.moments as moment
    where moment.owner_id = (select auth.jwt() ->> 'sub')
      and moment.id::text = split_part(name, '/', 2)
  )
);

create policy "Users can replace their own moment images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 3) = 'image'
  and exists (
    select 1
    from public.moments as moment
    where moment.owner_id = (select auth.jwt() ->> 'sub')
      and moment.id::text = split_part(name, '/', 2)
  )
)
with check (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 3) = 'image'
  and exists (
    select 1
    from public.moments as moment
    where moment.owner_id = (select auth.jwt() ->> 'sub')
      and moment.id::text = split_part(name, '/', 2)
  )
);

create policy "Users can delete their own moment images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'moment-images'
  and coalesce((select auth.jwt() ->> 'sub'), '') <> ''
  and cardinality(string_to_array(name, '/')) = 3
  and split_part(name, '/', 1) = (select auth.jwt() ->> 'sub')
  and split_part(name, '/', 3) = 'image'
  and exists (
    select 1
    from public.moments as moment
    where moment.owner_id = (select auth.jwt() ->> 'sub')
      and moment.id::text = split_part(name, '/', 2)
  )
);
