create or replace function public.set_recruitment_callsign_details(
  p_token text,
  p_pid text,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.recruitment_exam_sessions%rowtype;
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
    raise exception 'Please complete and pass the written test first';
  end if;

  if exists (
    select 1
    from public.pilots p
    where upper(trim(p.pid)) = v_pid
      and (
        v_session.auth_user_id is null
        or p.user_id <> v_session.auth_user_id
      )
  ) then
    raise exception 'Callsign already taken';
  end if;

  update public.recruitment_exam_sessions
  set preferred_pid = v_pid,
      pending_email = coalesce(nullif(trim(p_email), ''), pending_email)
  where id = v_session.id;

  return jsonb_build_object('ok', true, 'pid', v_pid);
end;
$$;
