-- Harden denied PIREP cleanup scheduling to avoid parser/runtime failures
-- when pg_cron is not installed yet.

DO $$
BEGIN
  -- Attempt to ensure extension exists (no-op if already installed).
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore extension creation failures (managed environments may restrict this).
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $$
        SELECT cron.unschedule(jobid)
        FROM cron.job
        WHERE jobname = 'cleanup-denied-pireps-daily'
      $$;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      EXECUTE $$
        SELECT cron.schedule(
          'cleanup-denied-pireps-daily',
          '0 3 * * *',
          'SELECT public.cleanup_old_denied_pireps();'
        )
      $$;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;
