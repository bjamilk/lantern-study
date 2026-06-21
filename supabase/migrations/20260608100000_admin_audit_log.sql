-- Admin audit log for platform moderation actions

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_id_idx on public.admin_audit_log (actor_id);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log (action);

alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_service_role_only" on public.admin_audit_log;
create policy "admin_audit_log_service_role_only"
  on public.admin_audit_log
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert on table public.admin_audit_log to service_role;

-- Soft-delete marker for admin deck moderation
alter table public.decks add column if not exists removed_by_admin_at timestamptz;

-- Marketplace report moderation fields (if not already present)
alter table public.marketplace_reports add column if not exists admin_note text;
alter table public.marketplace_reports add column if not exists resolved_by uuid references public.profiles(id) on delete set null;
alter table public.marketplace_reports add column if not exists resolved_at timestamptz;

-- Normalize open queue status alias: pending is the canonical open state
update public.marketplace_reports set status = 'pending' where status = 'open';
