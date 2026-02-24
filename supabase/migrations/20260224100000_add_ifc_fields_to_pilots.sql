alter table public.pilots
  add column if not exists ifc_user_id text,
  add column if not exists ifc_username text;
