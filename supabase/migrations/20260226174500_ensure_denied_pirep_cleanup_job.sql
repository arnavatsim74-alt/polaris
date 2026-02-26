-- Ensure denied-pirep cleanup cron job exists and is visible in cron.job.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron extension is not enabled. Enable pg_cron before scheduling cleanup-denied-pireps-daily.';
  END IF;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'cleanup-denied-pireps-daily';

  PERFORM cron.schedule(
    'cleanup-denied-pireps-daily',
    '0 3 * * *',
    'SELECT public.cleanup_old_denied_pireps();'
  );
END;
$$;
