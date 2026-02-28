-- Revert PIREP status hardening/auto-cleanup changes.
-- Keep canonical status handling as: pending, approved, denied, on_hold.
-- Disable all auto-removal jobs/triggers for denied PIREPs.

-- 1) Disable auto cleanup triggers/functions.
DROP TRIGGER IF EXISTS cleanup_denied_pireps_trigger ON public.pireps;
DROP TRIGGER IF EXISTS normalize_pirep_status_rejected_trigger ON public.pireps;

DROP FUNCTION IF EXISTS public.trigger_cleanup_denied_pireps();
DROP FUNCTION IF EXISTS public.cleanup_old_denied_pireps();
DROP FUNCTION IF EXISTS public.normalize_pirep_status_rejected();

-- 2) Disable cron-based denied cleanup job if pg_cron is installed.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR v_job_id IN
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'cleanup-denied-pireps-daily'
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;
  END IF;
END;
$$;

-- 3) Remove legacy `rejected` from pirep_status by recreating enum without it.
--    (Postgres does not support dropping a single enum value in-place.)
ALTER TABLE public.pireps
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.pireps
  ALTER COLUMN status TYPE text
  USING status::text;

UPDATE public.pireps
SET status = 'denied'
WHERE status = 'rejected';

DROP TYPE IF EXISTS public.pirep_status;

CREATE TYPE public.pirep_status AS ENUM ('pending', 'approved', 'denied', 'on_hold');

ALTER TABLE public.pireps
  ALTER COLUMN status TYPE public.pirep_status
  USING status::public.pirep_status;

ALTER TABLE public.pireps
  ALTER COLUMN status SET DEFAULT 'pending';
