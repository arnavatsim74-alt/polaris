alter table public.recruitment_exam_sessions
  alter column application_id drop not null;

alter table public.recruitment_exam_sessions
  add column if not exists preferred_pid text,
  add column if not exists pending_email text,
  add column if not exists practical_assigned_at timestamptz;

create index if not exists idx_recruitment_exam_sessions_preferred_pid
  on public.recruitment_exam_sessions(preferred_pid);

create or replace function public.ensure_application_for_recruitment(
  p_user_id uuid,
  p_discord_user_id text,
  p_username text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_id uuid;
  v_email text;
  v_name text;
begin
  v_email := coalesce(nullif(trim(p_email), ''), concat('discord-', p_user_id::text, '@users.noreply.local'));
  v_name := coalesce(nullif(trim(p_username), ''), 'Recruit Pilot');

  select id into v_app_id
  from public.pilot_applications
  where user_id = p_user_id
  limit 1;

  if v_app_id is not null then
    update public.pilot_applications
    set discord_user_id = coalesce(discord_user_id, p_discord_user_id),
        email = coalesce(email, v_email),
        full_name = coalesce(full_name, v_name)
    where id = v_app_id;

    return v_app_id;
  end if;

  insert into public.pilot_applications (
    user_id, email, full_name,
    experience_level, preferred_simulator, reason_for_joining,
    discord_username, if_grade, is_ifatc, ifc_trust_level,
    age_range, other_va_membership, hear_about_aflv,
    discord_user_id, status
  )
  values (
    p_user_id,
    v_email,
    v_name,
    'Grade 2', 'No', 'Recruitment flow',
    v_name, 'Grade 2', 'No', 'I don''t know',
    '13-16', 'No', 'Discord Recruitment',
    p_discord_user_id,
    'pending'
  )
  returning id into v_app_id;

  return v_app_id;
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

  v_app_id := public.ensure_application_for_recruitment(v_user_id, v_session.discord_user_id, coalesce(v_session.discord_user_id, 'Recruit Pilot'), v_email);

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
    insert into public.pilots (user_id, pid, full_name, vatsim_id, ivao_id, discord_user_id)
    values (v_user_id, v_session.preferred_pid, v_app.full_name, v_app.vatsim_id, v_app.ivao_id, v_session.discord_user_id);

    insert into public.user_roles (user_id, role)
    values (v_user_id, 'pilot')
    on conflict do nothing;
  else
    update public.pilots
    set pid = v_session.preferred_pid,
        discord_user_id = coalesce(discord_user_id, v_session.discord_user_id)
    where id = v_existing_pilot;
  end if;

  update public.pilot_applications
  set status = 'approved',
      assigned_pid = v_session.preferred_pid,
      reviewed_at = coalesce(reviewed_at, now())
  where id = v_app_id;

  return jsonb_build_object('approved', true, 'pid', v_session.preferred_pid, 'user_id', v_user_id);
end;
$$;

create or replace function public.complete_recruitment_with_pid(p_token text, p_pid text, p_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.recruitment_exam_sessions%rowtype;
  v_pid text;
begin
  v_pid := upper(trim(p_pid));
  if v_pid !~ '^AFLV[A-Z0-9]{3}$' then
    raise exception 'Callsign must be in AFLVXXX format';
  end if;

  select * into v_token from public.recruitment_exam_sessions where token = p_token limit 1;
  if v_token.id is null then
    raise exception 'Invalid recruitment token';
  end if;

  if coalesce(v_token.passed, false) = false then
    raise exception 'Entrance exam not passed yet';
  end if;

  update public.recruitment_exam_sessions
  set preferred_pid = v_pid,
      pending_email = coalesce(nullif(trim(p_email), ''), pending_email)
  where id = v_token.id;

  return public.finalize_recruitment_registration(p_token);
end;
$$;

create or replace function public.assign_recruitment_practical(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.recruitment_exam_sessions%rowtype;
  v_pilot public.pilots%rowtype;
  v_app public.pilot_applications%rowtype;
  v_practical_setting text;
  v_course_id uuid;
  v_practical_id uuid;
begin
  select * into v_session from public.recruitment_exam_sessions where token = p_token limit 1;
  if v_session.id is null then
    raise exception 'Invalid recruitment token';
  end if;

  perform public.finalize_recruitment_registration(p_token);

  select * into v_session from public.recruitment_exam_sessions where id = v_session.id;
  if v_session.auth_user_id is null then
    return jsonb_build_object('ok', false, 'requires_registration', true);
  end if;

  select * into v_app from public.pilot_applications where user_id = v_session.auth_user_id limit 1;
  if v_app.id is null or v_app.status <> 'approved' then
    return jsonb_build_object('ok', false, 'message', 'Application not approved yet');
  end if;

  select * into v_pilot from public.pilots where user_id = v_session.auth_user_id limit 1;
  if v_pilot.id is null then
    return jsonb_build_object('ok', false, 'message', 'Pilot profile not found');
  end if;

  if exists (
    select 1 from public.academy_practicals
    where pilot_id = v_pilot.id
      and status in ('scheduled', 'completed')
      and notes ilike 'Recruitment practical%'
  ) then
    return jsonb_build_object('ok', true, 'already_assigned', true, 'pid', v_pilot.pid);
  end if;

  select value into v_practical_setting from public.site_settings where key = 'recruitment_practical_id' limit 1;

  if v_practical_setting is not null and v_practical_setting ~* '^[0-9a-f-]{36}$' then
    v_course_id := v_practical_setting::uuid;
  else
    v_course_id := null;
  end if;

  insert into public.academy_practicals (pilot_id, course_id, status, notes)
  values (
    v_pilot.id,
    v_course_id,
    'scheduled',
    format('Recruitment practical\n1.Spawn at any gate at UUBW.\n2.Taxi to RWY30\n3.Depart Straight & Transition to UUDD Pattern for RWY32L\n4.Touch and go. with proper unicom use.\n5.Transistion to UUDD RWY32R Downwind.\n6.Touch and go. Departure to Northwest\n7.Proceed Direct "MR" Moscow Shr. VOR.\n8.Transition to pattern for LANDING at ANY RWY at UUEE\n9.Land. Park. Exit.\n\nATYP - C172\nCALLSIGN - Aeroflot %sCR', v_pilot.pid)
  )
  returning id into v_practical_id;

  update public.recruitment_exam_sessions
  set practical_assigned_at = now()
  where id = v_session.id;

  return jsonb_build_object('ok', true, 'assigned', true, 'practical_id', v_practical_id, 'pid', v_pilot.pid);
end;
$$;
