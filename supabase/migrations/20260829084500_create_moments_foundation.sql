create table public.moments (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default (auth.jwt() ->> 'sub'),
  title text not null,
  description text not null,
  mood text not null,
  moment_date date not null,
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint moments_owner_id_not_blank check (
    owner_id = btrim(owner_id)
    and char_length(owner_id) between 1 and 255
  ),
  constraint moments_title_length check (
    title = btrim(title)
    and char_length(title) between 1 and 80
  ),
  constraint moments_description_length check (
    description = btrim(description)
    and char_length(description) between 1 and 280
  ),
  constraint moments_mood_allowed check (
    mood in ('happy', 'calm', 'loved', 'sad', 'angry', 'tired')
  ),
  constraint moments_image_owner_path check (
    image_path is null
    or image_path like owner_id || '/' || id::text || '/%'
  )
);

comment on table public.moments is
  'Private Mood & Moments entries owned by Clerk users.';
comment on column public.moments.owner_id is
  'The Clerk session token sub claim. This is not a Supabase Auth user ID.';
comment on column public.moments.image_path is
  'Private moment-images bucket path; never a public or signed URL.';

create index moments_owner_timeline_idx
  on public.moments (owner_id, moment_date desc, created_at desc);

create function public.set_moments_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function public.set_moments_updated_at() from public;

create trigger moments_set_updated_at
before update on public.moments
for each row
execute function public.set_moments_updated_at();

alter table public.moments enable row level security;

revoke all on table public.moments from anon;
revoke all on table public.moments from authenticated;

grant select, delete on table public.moments to authenticated;
grant insert (title, description, mood, moment_date, image_path)
  on table public.moments to authenticated;
grant update (title, description, mood, moment_date, image_path)
  on table public.moments to authenticated;

create policy "Users can read their own moments"
on public.moments
for select
to authenticated
using ((select auth.jwt() ->> 'sub') = owner_id);

create policy "Users can insert their own moments"
on public.moments
for insert
to authenticated
with check ((select auth.jwt() ->> 'sub') = owner_id);

create policy "Users can update their own moments"
on public.moments
for update
to authenticated
using ((select auth.jwt() ->> 'sub') = owner_id)
with check ((select auth.jwt() ->> 'sub') = owner_id);

create policy "Users can delete their own moments"
on public.moments
for delete
to authenticated
using ((select auth.jwt() ->> 'sub') = owner_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'moment-images',
  'moment-images',
  false,
  1000000,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read their own moment images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'moment-images'
  and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
);

create policy "Users can upload their own moment images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'moment-images'
  and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
);

create policy "Users can delete their own moment images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'moment-images'
  and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
);
