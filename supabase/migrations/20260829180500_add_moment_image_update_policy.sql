create policy "Users can replace their own moment images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'moment-images'
  and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
)
with check (
  bucket_id = 'moment-images'
  and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
);
