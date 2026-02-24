do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'pirep_validation_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.pirep_validation_status as enum ('validated', 'not_validated', 'error');
  end if;
end $$;

alter table public.pireps
  add column if not exists validation_status public.pirep_validation_status,
  add column if not exists validation_checked_at timestamptz,
  add column if not exists validation_details jsonb,
  add column if not exists validation_override_by uuid,
  add column if not exists validation_override_reason text;
