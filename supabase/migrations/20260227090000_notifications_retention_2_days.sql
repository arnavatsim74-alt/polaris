-- Reduce notification retention to 2 days and ensure daily cleanup job exists.

create or replace function public.cleanup_old_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
  where created_at < now() - interval '2 days';
end;
$$;

-- run once immediately
select public.cleanup_old_notifications();

-- schedule daily cleanup (idempotent; no-op if pg_cron isn't available)
do $$
begin
  begin
    perform 1 from cron.job where jobname = 'cleanup_old_notifications_daily';
  exception
    when undefined_table then
      return;
  end;

  if not exists (select 1 from cron.job where jobname = 'cleanup_old_notifications_daily') then
    perform cron.schedule(
      'cleanup_old_notifications_daily',
      '0 3 * * *',
      $job$select public.cleanup_old_notifications();$job$
    );
  end if;
end;
$$;
