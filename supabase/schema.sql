create table if not exists public.ero_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  mon_thu_paddles text[] not null default '{}',
  friday_paddles text[] not null default '{}',
  saturday_paddles text[] not null default '{}',
  sunday_paddles text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.ero_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists ero_user_profiles_set_updated_at on public.ero_user_profiles;
create trigger ero_user_profiles_set_updated_at
before update on public.ero_user_profiles
for each row
execute function public.ero_set_updated_at();

alter table public.ero_user_profiles enable row level security;

drop policy if exists "Users can view their own ERO profile" on public.ero_user_profiles;
create policy "Users can view their own ERO profile"
on public.ero_user_profiles
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own ERO profile" on public.ero_user_profiles;
create policy "Users can insert their own ERO profile"
on public.ero_user_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own ERO profile" on public.ero_user_profiles;
create policy "Users can update their own ERO profile"
on public.ero_user_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
