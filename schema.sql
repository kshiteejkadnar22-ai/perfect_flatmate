-- Run this entire script in Supabase SQL Editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  bio text not null default '',
  preferences jsonb not null default '{}'::jsonb,
  has_profile boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_id)
);

alter table public.profiles enable row level security;
alter table public.likes enable row level security;

-- Authenticated FlatMate users can discover public profile fields.
create policy "Authenticated users can read completed profiles"
on public.profiles for select to authenticated
using (has_profile = true or id = auth.uid());

create policy "Users can create their own profile"
on public.profiles for insert to authenticated
with check (id = auth.uid());

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Users can read their own likes"
on public.likes for select to authenticated
using (user_id = auth.uid());

create policy "Users can add their own likes"
on public.likes for insert to authenticated
with check (user_id = auth.uid());

create policy "Users can remove their own likes"
on public.likes for delete to authenticated
using (user_id = auth.uid());

grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.likes to authenticated;
