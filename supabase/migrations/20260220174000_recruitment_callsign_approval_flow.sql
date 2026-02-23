create or replace function public.submit_recruitment_exam(p_token text, p_score integer, p_passed boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.recruitment_exam_sessions%rowtype;
begin
  select * into v_session
  from public.recruitment_exam_sessions
  where token = p_token
  limit 1;

  if v_session.id is null then
    raise exception 'Invalid recruitment token';
  end if;

  if v_session.completed_at is not null then
    return jsonb_build_object('ok', true, 'already_completed', true, 'passed', v_session.passed, 'score', v_session.score);
  end if;

  update public.recruitment_exam_sessions
  set score = p_score,
      passed = p_passed,
      completed_at = now()
  where id = v_session.id;

  if not p_passed then
    return jsonb_build_object('ok', true, 'passed', false, 'score', p_score);
  end if;

  return jsonb_build_object('ok', true, 'passed', true, 'score', p_score, 'requires_callsign', true);
end;
$$;

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
    insert into public.pilots (user_id, pid, full_name, vatsim_id, ivao_id)
    values (v_app.user_id, v_pid, v_app.full_name, v_app.vatsim_id, v_app.ivao_id)
    on conflict (user_id) do update set pid = excluded.pid;

    insert into public.user_roles (user_id, role)
    values (v_app.user_id, 'pilot')
    on conflict do nothing;
  else
    update public.pilots set pid = v_pid where id = v_existing_pilot;
  end if;

  update public.pilot_applications
  set status = 'approved',
      assigned_pid = v_pid,
      reviewed_at = coalesce(reviewed_at, now())
  where id = v_app.id;

  return jsonb_build_object('approved', true, 'pid', v_pid);
end;
$$;
