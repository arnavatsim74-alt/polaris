alter table public.pilots
  add column if not exists approval_status public.application_status not null default 'approved';

create index if not exists idx_pilots_approval_status
  on public.pilots (approval_status);

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
begin
  v_actor_id := auth.uid();

  if v_actor_id is null or not public.has_role(v_actor_id, 'admin') then
    raise exception 'Only admins can approve applications';
  end if;

  v_pid := upper(trim(p_pid));

  if v_pid !~ '^LATV[A-Z0-9]{3}$' then
    raise exception 'Callsign must be in LATVXXX format';
  end if;

  select * into v_app
  from public.pilot_applications
  where id = p_app_id
  limit 1;

  if v_app.id is null then
    raise exception 'Application not found';
  end if;

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
      approval_status
    )
    values (
      v_app.user_id,
      v_pid,
      v_app.full_name,
      v_app.vatsim_id,
      v_app.ivao_id,
      nullif(trim(v_app.discord_username), ''),
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

create or replace function public.finalize_recruitment_registration(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_session public.recruitment_exam_sessions%rowtype;
  v_app public.pilot_applications%rowtype;
  v_existing_pilot uuid;
  v_user_id uuid;
  v_app_id uuid;
  v_email text;
  v_discord_username text;
begin
  select * into v_session
  from public.recruitment_exam_sessions
  where token = p_token
  limit 1;

  if v_session.id is null then
    raise exception 'Invalid recruitment token';
  end if;

  if coalesce(v_session.passed, false) = false then
    raise exception 'Entrance exam not passed yet';
  end if;

  if v_session.preferred_pid is null then
    return jsonb_build_object('approved', false, 'requires_callsign', true);
  end if;

  v_user_id := v_session.auth_user_id;

  if v_user_id is null and v_session.discord_user_id is not null then
    v_user_id := public.get_auth_user_id_by_discord(v_session.discord_user_id);
  end if;

  v_email := nullif(trim(v_session.pending_email), '');
  if v_user_id is null and v_email is not null then
    select u.id into v_user_id
    from auth.users u
    where lower(u.email) = lower(v_email)
    order by u.created_at desc
    limit 1;
  end if;

  if v_user_id is null then
    return jsonb_build_object('approved', false, 'requires_registration', true, 'message', 'Register on Crew Center first');
  end if;

  select coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'preferred_username'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'global_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'user_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      'Recruit Pilot'
    ) into v_discord_username
  from auth.users u
  where u.id = v_user_id
  limit 1;

  v_app_id := public.ensure_application_for_recruitment(v_user_id, v_session.discord_user_id, v_discord_username, v_email);

  update public.recruitment_exam_sessions
  set auth_user_id = v_user_id,
      application_id = v_app_id
  where id = v_session.id;

  select * into v_app from public.pilot_applications where id = v_app_id limit 1;

  if exists (select 1 from public.pilots where pid = v_session.preferred_pid and user_id <> v_user_id) then
    return jsonb_build_object('approved', false, 'message', 'Callsign already taken');
  end if;

  select id into v_existing_pilot
  from public.pilots
  where user_id = v_user_id
  limit 1;

  if v_existing_pilot is null then
    insert into public.pilots (user_id, pid, full_name, vatsim_id, ivao_id, discord_user_id, discord_username, approval_status)
    values (
      v_user_id,
      v_session.preferred_pid,
      v_app.full_name,
      v_app.vatsim_id,
      v_app.ivao_id,
      v_session.discord_user_id,
      nullif(trim(v_app.discord_username), ''),
      'approved'
    );

    insert into public.user_roles (user_id, role)
    values (v_user_id, 'pilot')
    on conflict do nothing;
  else
    update public.pilots
    set pid = v_session.preferred_pid,
        discord_user_id = coalesce(discord_user_id, v_session.discord_user_id),
        discord_username = coalesce(discord_username, nullif(trim(v_app.discord_username), '')),
        approval_status = 'approved'
    where id = v_existing_pilot;
  end if;

  delete from public.pilot_applications
  where id = v_app_id;

  return jsonb_build_object('approved', true, 'pid', v_session.preferred_pid, 'user_id', v_user_id);
end;
$$;
