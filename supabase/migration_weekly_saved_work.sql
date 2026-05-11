alter table public.ero_user_profiles
  add column if not exists same_work_schedule boolean not null default true,
  add column if not exists week1_mon_thu_paddles text[] not null default '{}',
  add column if not exists week1_friday_paddles text[] not null default '{}',
  add column if not exists week1_saturday_paddles text[] not null default '{}',
  add column if not exists week1_sunday_paddles text[] not null default '{}',
  add column if not exists week2_mon_thu_paddles text[] not null default '{}',
  add column if not exists week2_friday_paddles text[] not null default '{}',
  add column if not exists week2_saturday_paddles text[] not null default '{}',
  add column if not exists week2_sunday_paddles text[] not null default '{}';

update public.ero_user_profiles
set
  week1_mon_thu_paddles = case when array_length(week1_mon_thu_paddles, 1) is null then mon_thu_paddles else week1_mon_thu_paddles end,
  week1_friday_paddles = case when array_length(week1_friday_paddles, 1) is null then friday_paddles else week1_friday_paddles end,
  week1_saturday_paddles = case when array_length(week1_saturday_paddles, 1) is null then saturday_paddles else week1_saturday_paddles end,
  week1_sunday_paddles = case when array_length(week1_sunday_paddles, 1) is null then sunday_paddles else week1_sunday_paddles end,
  week2_mon_thu_paddles = case when array_length(week2_mon_thu_paddles, 1) is null then mon_thu_paddles else week2_mon_thu_paddles end,
  week2_friday_paddles = case when array_length(week2_friday_paddles, 1) is null then friday_paddles else week2_friday_paddles end,
  week2_saturday_paddles = case when array_length(week2_saturday_paddles, 1) is null then saturday_paddles else week2_saturday_paddles end,
  week2_sunday_paddles = case when array_length(week2_sunday_paddles, 1) is null then sunday_paddles else week2_sunday_paddles end;
