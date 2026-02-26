-- Automatically remove denied PIREPs after 7 days.

CREATE OR REPLACE FUNCTION public.cleanup_old_denied_pireps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.pireps
  WHERE status = 'denied'
    AND COALESCE(reviewed_at, created_at) < NOW() - INTERVAL '7 days';
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'cleanup-denied-pireps-daily';

    PERFORM cron.schedule(
      'cleanup-denied-pireps-daily',
      '0 3 * * *',
      'SELECT public.cleanup_old_denied_pireps();'
    );
  END IF;
END;
$$;
