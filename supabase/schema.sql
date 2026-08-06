create table if not exists public.ero_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  mon_thu_paddles text[] not null default '{}',
  friday_paddles text[] not null default '{}',
  saturday_paddles text[] not null default '{}',
  sunday_paddles text[] not null default '{}',
  same_work_schedule boolean not null default true,
  week1_mon_thu_paddles text[] not null default '{}',
  week1_friday_paddles text[] not null default '{}',
  week1_saturday_paddles text[] not null default '{}',
  week1_sunday_paddles text[] not null default '{}',
  week2_mon_thu_paddles text[] not null default '{}',
  week2_friday_paddles text[] not null default '{}',
  week2_saturday_paddles text[] not null default '{}',
  week2_sunday_paddles text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.ero_user_profiles
add column if not exists email text;

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

create or replace function public.ero_normalize_email()
returns trigger
language plpgsql
as $$
begin
  new.email = lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists ero_user_profiles_normalize_email on public.ero_user_profiles;
create trigger ero_user_profiles_normalize_email
before insert or update on public.ero_user_profiles
for each row
execute function public.ero_normalize_email();

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

create table if not exists public.ero_lrv_defect_access (
  email text primary key,
  role text not null default 'reporter',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.ero_lrv_defect_access
add column if not exists role text not null default 'reporter';

update public.ero_lrv_defect_access
set email = lower(trim(email)),
    role = coalesce(nullif(trim(role), ''), 'reporter');

alter table public.ero_lrv_defect_access
drop constraint if exists ero_lrv_defect_access_email_normalized;

alter table public.ero_lrv_defect_access
add constraint ero_lrv_defect_access_email_normalized
check (email = lower(trim(email)) and length(email) > 3);

alter table public.ero_lrv_defect_access
drop constraint if exists ero_lrv_defect_access_role_check;

alter table public.ero_lrv_defect_access
add constraint ero_lrv_defect_access_role_check
check (role in ('viewer', 'reporter', 'admin'));

drop trigger if exists ero_lrv_defect_access_normalize_email on public.ero_lrv_defect_access;
create trigger ero_lrv_defect_access_normalize_email
before insert or update on public.ero_lrv_defect_access
for each row
execute function public.ero_normalize_email();

create index if not exists ero_lrv_defect_access_email_idx
on public.ero_lrv_defect_access (lower(email));

create table if not exists public.ero_lrv_defect_reports (
  id uuid primary key default gen_random_uuid(),
  lrv_number integer not null check (lrv_number between 1 and 99),
  cab text not null check (cab in ('MC1', 'MC2', 'UNKNOWN')),
  defect_category text,
  seat_issue_detail text,
  thermo_king_mode text,
  mlc_reported_at timestamptz,
  report_status text not null default 'open',
  defect_text text not null check (length(trim(defect_text)) > 0),
  reported_by uuid not null references auth.users(id) on delete cascade,
  reported_by_email text not null,
  reported_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ero_lrv_fleet (
  lrv_number integer primary key check (lrv_number between 1 and 99),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ero_lrv_fleet_managers (
  email text primary key,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.ero_lrv_fleet (lrv_number)
select generate_series(1, 68)
on conflict (lrv_number) do nothing;

alter table public.ero_lrv_fleet enable row level security;

update public.ero_lrv_fleet_managers
set email = lower(trim(email));

alter table public.ero_lrv_fleet_managers
drop constraint if exists ero_lrv_fleet_managers_email_normalized;

alter table public.ero_lrv_fleet_managers
add constraint ero_lrv_fleet_managers_email_normalized
check (email = lower(trim(email)) and length(email) > 3);

drop trigger if exists ero_lrv_fleet_managers_normalize_email on public.ero_lrv_fleet_managers;
create trigger ero_lrv_fleet_managers_normalize_email
before insert or update on public.ero_lrv_fleet_managers
for each row
execute function public.ero_normalize_email();

alter table public.ero_lrv_fleet_managers enable row level security;

alter table public.ero_lrv_defect_reports
add column if not exists defect_category text;

alter table public.ero_lrv_defect_reports
drop constraint if exists ero_lrv_defect_reports_lrv_number_check;

alter table public.ero_lrv_defect_reports
add constraint ero_lrv_defect_reports_lrv_number_check
check (lrv_number between 1 and 99);

alter table public.ero_lrv_defect_reports
add column if not exists seat_issue_detail text;

alter table public.ero_lrv_defect_reports
add column if not exists thermo_king_mode text;

alter table public.ero_lrv_defect_reports
drop column if exists cad_entry_at;

alter table public.ero_lrv_defect_reports
add column if not exists mlc_reported_at timestamptz;

alter table public.ero_lrv_defect_reports
add column if not exists report_status text not null default 'open';

update public.ero_lrv_defect_reports
set report_status = 'open'
where report_status is null;

alter table public.ero_lrv_defect_reports
drop constraint if exists ero_lrv_defect_reports_cab_check;

alter table public.ero_lrv_defect_reports
add constraint ero_lrv_defect_reports_cab_check
check (cab in ('MC1', 'MC2', 'UNKNOWN'));

alter table public.ero_lrv_defect_reports
drop constraint if exists ero_lrv_defect_reports_category_check;

alter table public.ero_lrv_defect_reports
add constraint ero_lrv_defect_reports_category_check
check (
  defect_category is null
  or defect_category in (
    'dirty_windshield',
    'nsa',
    'dars_volume',
    'traction_bell',
    'seat_issue',
    'headlight',
    'apex_light',
    'thermo_king',
    'other'
  )
);

alter table public.ero_lrv_defect_reports
drop constraint if exists ero_lrv_defect_reports_seat_detail_check;

alter table public.ero_lrv_defect_reports
add constraint ero_lrv_defect_reports_seat_detail_check
check (
  seat_issue_detail is null
  or seat_issue_detail in ('recliner', 'heated_seat', 'other')
);

alter table public.ero_lrv_defect_reports
drop constraint if exists ero_lrv_defect_reports_thermo_king_mode_check;

alter table public.ero_lrv_defect_reports
add constraint ero_lrv_defect_reports_thermo_king_mode_check
check (
  thermo_king_mode is null
  or thermo_king_mode in ('heat', 'cold')
);

alter table public.ero_lrv_defect_reports
drop constraint if exists ero_lrv_defect_reports_status_check;

alter table public.ero_lrv_defect_reports
add constraint ero_lrv_defect_reports_status_check
check (report_status in ('open', 'addressed', 'solved'));

create index if not exists ero_lrv_defect_reports_lrv_idx
on public.ero_lrv_defect_reports (lrv_number, reported_at desc);

create index if not exists ero_lrv_defect_reports_reported_at_idx
on public.ero_lrv_defect_reports (reported_at desc);

create or replace function public.ero_is_lrv_defect_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1
      from public.ero_lrv_defect_access access
      where access.email = lower(coalesce((auth.jwt() ->> 'email'), ''))
        and access.role = 'admin'
    );
$$;

create or replace function public.ero_can_access_lrv_defects()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ero_is_lrv_defect_admin()
    or exists (
      select 1
      from public.ero_lrv_defect_access access
      where access.email = lower(coalesce((auth.jwt() ->> 'email'), ''))
        and access.role in ('viewer', 'reporter', 'admin')
    );
$$;

create or replace function public.ero_can_report_lrv_defects()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ero_is_lrv_defect_admin()
    or exists (
      select 1
      from public.ero_lrv_defect_access access
      where access.email = lower(coalesce((auth.jwt() ->> 'email'), ''))
        and access.role in ('reporter', 'admin')
    );
$$;

create or replace function public.ero_can_manage_lrv_fleet()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ero_lrv_fleet_managers manager
    where manager.email = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );
$$;

alter table public.ero_lrv_defect_access enable row level security;
alter table public.ero_lrv_defect_reports enable row level security;
alter table public.ero_lrv_fleet enable row level security;
alter table public.ero_lrv_fleet_managers enable row level security;

drop policy if exists "Authorized users can view LRV fleet" on public.ero_lrv_fleet;
create policy "Authorized users can view LRV fleet"
on public.ero_lrv_fleet
for select
using (public.ero_can_access_lrv_defects());

drop policy if exists "Fleet managers can add LRVs" on public.ero_lrv_fleet;
create policy "Fleet managers can add LRVs"
on public.ero_lrv_fleet
for insert
with check (
  public.ero_can_manage_lrv_fleet()
  and lrv_number between 1 and 99
);

drop policy if exists "Fleet managers can remove LRVs" on public.ero_lrv_fleet;
create policy "Fleet managers can remove LRVs"
on public.ero_lrv_fleet
for delete
using (public.ero_can_manage_lrv_fleet());

drop policy if exists "Fleet managers can view their own grant" on public.ero_lrv_fleet_managers;
create policy "Fleet managers can view their own grant"
on public.ero_lrv_fleet_managers
for select
using (email = lower(coalesce((auth.jwt() ->> 'email'), '')));

drop policy if exists "LRV defect admins can view fleet managers" on public.ero_lrv_fleet_managers;
create policy "LRV defect admins can view fleet managers"
on public.ero_lrv_fleet_managers
for select
using (public.ero_is_lrv_defect_admin());

drop policy if exists "LRV defect admins can view ERO profiles" on public.ero_user_profiles;
create policy "LRV defect admins can view ERO profiles"
on public.ero_user_profiles
for select
using (public.ero_is_lrv_defect_admin());

drop policy if exists "LRV defect admins can view access" on public.ero_lrv_defect_access;
create policy "LRV defect admins can view access"
on public.ero_lrv_defect_access
for select
using (public.ero_is_lrv_defect_admin());

drop policy if exists "Users can view their own LRV defect access" on public.ero_lrv_defect_access;
create policy "Users can view their own LRV defect access"
on public.ero_lrv_defect_access
for select
using (email = lower(coalesce((auth.jwt() ->> 'email'), '')));

drop policy if exists "LRV defect admins can grant access" on public.ero_lrv_defect_access;
create policy "LRV defect admins can grant access"
on public.ero_lrv_defect_access
for insert
with check (
  public.ero_is_lrv_defect_admin()
  and email = lower(trim(email))
  and role in ('viewer', 'reporter', 'admin')
);

drop policy if exists "LRV defect admins can update access" on public.ero_lrv_defect_access;
create policy "LRV defect admins can update access"
on public.ero_lrv_defect_access
for update
using (public.ero_is_lrv_defect_admin())
with check (
  public.ero_is_lrv_defect_admin()
  and email = lower(trim(email))
  and role in ('viewer', 'reporter', 'admin')
);

drop policy if exists "LRV defect admins can revoke access" on public.ero_lrv_defect_access;
create policy "LRV defect admins can revoke access"
on public.ero_lrv_defect_access
for delete
using (public.ero_is_lrv_defect_admin());

drop policy if exists "Authorized users can view LRV defects" on public.ero_lrv_defect_reports;
create policy "Authorized users can view LRV defects"
on public.ero_lrv_defect_reports
for select
using (public.ero_can_access_lrv_defects());

drop policy if exists "Authorized users can report LRV defects" on public.ero_lrv_defect_reports;
create policy "Authorized users can report LRV defects"
on public.ero_lrv_defect_reports
for insert
with check (
  public.ero_can_report_lrv_defects()
  and reported_by = auth.uid()
  and lower(reported_by_email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
);

drop policy if exists "LRV defect admins can delete reports" on public.ero_lrv_defect_reports;
create policy "LRV defect admins can delete reports"
on public.ero_lrv_defect_reports
for delete
using (public.ero_is_lrv_defect_admin());

drop policy if exists "LRV defect admins can update reports" on public.ero_lrv_defect_reports;
create policy "LRV defect admins can update reports"
on public.ero_lrv_defect_reports
for update
using (public.ero_is_lrv_defect_admin())
with check (public.ero_is_lrv_defect_admin());
