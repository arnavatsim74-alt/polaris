alter table public.recruitment_exam_sessions
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists discord_user_id text;

create index if not exists idx_recruitment_exam_sessions_auth_user_id
  on public.recruitment_exam_sessions(auth_user_id);

create index if not exists idx_recruitment_exam_sessions_discord_user_id
  on public.recruitment_exam_sessions(discord_user_id);

alter table public.academy_practicals
  alter column course_id drop not null;

create or replace function public.complete_recruitment_with_pid(p_token text, p_pid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.recruitment_exam_sessions%rowtype;
  v_app public.pilot_applications%rowtype;
  v_existing_pilot uuid;
  v_pid text;
  v_pilot_id uuid;
  v_practical_setting text;
  v_practical_id uuid;
begin
  v_pid := upper(trim(p_pid));
  if v_pid !~ '^AFLV[A-Z0-9]{3}$' then
    raise exception 'Callsign must be in AFLVXXX format';
  end if;

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

  if exists (select 1 from public.pilots where pid = v_pid) then
    return jsonb_build_object('approved', false, 'message', 'Callsign already taken');
  end if;

  select * into v_app
  from public.pilot_applications
  where id = v_session.application_id
  limit 1;

  if v_app.id is null then
    raise exception 'Linked application not found';
  end if;

  select id into v_existing_pilot
  from public.pilots
  where user_id = v_app.user_id
  limit 1;

  if v_existing_pilot is null then
    insert into public.pilots (user_id, pid, full_name, vatsim_id, ivao_id, discord_user_id)
    values (v_app.user_id, v_pid, v_app.full_name, v_app.vatsim_id, v_app.ivao_id, v_app.discord_user_id)
    on conflict (user_id) do update set
      pid = excluded.pid,
      discord_user_id = coalesce(public.pilots.discord_user_id, excluded.discord_user_id)
    returning id into v_pilot_id;

    insert into public.user_roles (user_id, role)
    values (v_app.user_id, 'pilot')
    on conflict do nothing;
  else
    update public.pilots
    set pid = v_pid,
        discord_user_id = coalesce(discord_user_id, v_app.discord_user_id)
    where id = v_existing_pilot
    returning id into v_pilot_id;
  end if;

  update public.pilot_applications
  set status = 'approved',
      assigned_pid = v_pid,
      reviewed_at = coalesce(reviewed_at, now())
  where id = v_app.id;

  select value into v_practical_setting
  from public.site_settings
  where key = 'recruitment_practical_id'
  limit 1;

  if v_practical_setting is not null and v_practical_setting ~* '^[0-9a-f-]{36}$' then
    v_practical_id := v_practical_setting::uuid;

    if not exists (
      select 1
      from public.academy_practicals ap
      where ap.pilot_id = v_pilot_id
        and ap.notes = 'Recruitment auto-assigned practical'
        and ap.course_id is not distinct from v_practical_id
    ) then
      insert into public.academy_practicals (pilot_id, course_id, status, notes)
      values (v_pilot_id, v_practical_id, 'scheduled', 'Recruitment auto-assigned practical');
    end if;
  elsif v_practical_setting is null or lower(trim(v_practical_setting)) = 'standalone' then
    if not exists (
      select 1
      from public.academy_practicals ap
      where ap.pilot_id = v_pilot_id
        and ap.notes = 'Recruitment auto-assigned practical'
        and ap.course_id is null
    ) then
      insert into public.academy_practicals (pilot_id, course_id, status, notes)
      values (v_pilot_id, null, 'scheduled', 'Recruitment auto-assigned practical');
    end if;
  end if;

  return jsonb_build_object('approved', true, 'pid', v_pid, 'practical_assigned', v_practical_setting is not null);
end;
$$;
