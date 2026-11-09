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

-- A completed profile is visible to signed-in FlatMate users; incomplete profiles remain private.
-- Drop named policies first so this setup script can safely be run again.
drop policy if exists "Authenticated users can read completed profiles" on public.profiles;
drop policy if exists "Users can create their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can read their own likes" on public.likes;
drop policy if exists "Users can add their own likes" on public.likes;
drop policy if exists "Users can remove their own likes" on public.likes;

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

-- Connection requests between registered users
create table if not exists public.connection_requests (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references auth.users(id) on delete cascade,
    receiver_id uuid not null references auth.users(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'declined')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (sender_id <> receiver_id),
    unique (sender_id, receiver_id)
);

-- Private contact details
create table if not exists public.profile_contacts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    whatsapp text not null
);

alter table public.connection_requests enable row level security;
alter table public.profile_contacts enable row level security;

-- Users can see requests involving themselves
create policy "Users can view their connection requests"
on public.connection_requests
for select to authenticated
using (sender_id = auth.uid() or receiver_id = auth.uid());

-- Users can send requests as themselves
create policy "Users can send connection requests"
on public.connection_requests
for insert to authenticated
with check (
    sender_id = auth.uid()
    and receiver_id <> auth.uid()
);

-- Only the receiver can accept or decline a pending request
create policy "Receiver can respond to requests"
on public.connection_requests
for update to authenticated
using (
    receiver_id = auth.uid()
    and status = 'pending'
)
with check (
    receiver_id = auth.uid()
    and status in ('accepted', 'declined')
);

-- Users can add and update their own contact details
create policy "Users manage their own contact"
on public.profile_contacts
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Contact details are visible to the owner and accepted connections
create policy "Accepted connections can view contact"
on public.profile_contacts
for select to authenticated
using (
    user_id = auth.uid()
    or exists (
        select 1
        from public.connection_requests cr
        where cr.status = 'accepted'
        and (
            (cr.sender_id = auth.uid() and cr.receiver_id = user_id)
            or
            (cr.receiver_id = auth.uid() and cr.sender_id = user_id)
        )
    )
);

grant select, insert, update on public.connection_requests to authenticated;
grant select, insert, update, delete on public.profile_contacts to authenticated;
