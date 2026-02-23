alter table public.pireps
  add column if not exists pax integer,
  add column if not exists cargo_kg numeric;

alter table public.pireps
  drop constraint if exists pireps_pax_nonnegative,
  add constraint pireps_pax_nonnegative check (pax is null or pax >= 0),
  drop constraint if exists pireps_cargo_kg_nonnegative,
  add constraint pireps_cargo_kg_nonnegative check (cargo_kg is null or cargo_kg >= 0);
