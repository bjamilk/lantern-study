-- Optional helper table for listing platform admins in app queries.
-- Canonical privilege is still auth.users.raw_app_meta_data -> is_platform_admin.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

drop policy if exists "platform_admins_service_role_only" on public.platform_admins;
create policy "platform_admins_service_role_only"
  on public.platform_admins
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on table public.platform_admins to service_role;
