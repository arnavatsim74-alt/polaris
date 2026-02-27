alter table public.pilots
  drop column if exists ifc_user_id;

create or replace function public.approve_pilot_application(p_app_id uuid, p_pid text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.pilot_applications%rowtype;
  v_pid text;
  v_actor_id uuid;
  v_existing_pilot uuid;
  v_ifc_username text;
begin
  v_actor_id := auth.uid();

  if v_actor_id is null or not public.has_role(v_actor_id, 'admin') then
    raise exception 'Only admins can approve applications';
  end if;

  v_pid := upper(trim(p_pid));

  select * into v_app
  from public.pilot_applications
  where id = p_app_id
  limit 1;

  if v_app.id is null then
    raise exception 'Application not found';
  end if;

  v_ifc_username := nullif(regexp_replace(trim(coalesce(v_app.ifc_profile_url, '')), '^@+', ''), '');

  if exists (
    select 1 from public.pilots p
    where p.pid = v_pid and p.user_id <> v_app.user_id
  ) then
    raise exception 'Callsign already in use';
  end if;

  select id into v_existing_pilot
  from public.pilots
  where user_id = v_app.user_id
  limit 1;

  if v_existing_pilot is null then
    insert into public.pilots (
      user_id,
      pid,
      full_name,
      vatsim_id,
      ivao_id,
      discord_username,
      ifc_username,
      approval_status
    )
    values (
      v_app.user_id,
      v_pid,
      v_app.full_name,
      v_app.vatsim_id,
      v_app.ivao_id,
      nullif(trim(v_app.discord_username), ''),
      v_ifc_username,
      'approved'
    )
    returning id into v_existing_pilot;
  else
    update public.pilots
    set pid = v_pid,
        full_name = coalesce(nullif(trim(v_app.full_name), ''), full_name),
        vatsim_id = coalesce(vatsim_id, v_app.vatsim_id),
        ivao_id = coalesce(ivao_id, v_app.ivao_id),
        discord_username = coalesce(discord_username, nullif(trim(v_app.discord_username), '')),
        ifc_username = coalesce(ifc_username, v_ifc_username),
        approval_status = 'approved'
    where id = v_existing_pilot;
  end if;

  insert into public.user_roles (user_id, role)
  values (v_app.user_id, 'pilot')
  on conflict do nothing;

  delete from public.pilot_applications
  where id = v_app.id;

  return v_existing_pilot;
end;
$$;
