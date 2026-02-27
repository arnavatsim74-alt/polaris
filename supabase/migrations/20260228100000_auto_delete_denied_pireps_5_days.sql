-- Auto-delete denied Pireps after 5 days
-- Uses trigger on insert/update + pg_cron for daily scheduling

-- Function to clean up old denied Pireps
CREATE OR REPLACE FUNCTION public.cleanup_old_denied_pireps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.pireps
  WHERE status = 'denied'
    AND created_at < NOW() - INTERVAL '5 days';
END;
$$;

-- Trigger function for INSERT
CREATE OR REPLACE FUNCTION public.trigger_cleanup_denied_pireps_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'denied' THEN
    DELETE FROM public.pireps
    WHERE status = 'denied'
      AND created_at < NOW() - INTERVAL '5 days';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger function for UPDATE
CREATE OR REPLACE FUNCTION public.trigger_cleanup_denied_pireps_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'denied' AND OLD.status != 'denied' THEN
    DELETE FROM public.pireps
    WHERE status = 'denied'
      AND created_at < NOW() - INTERVAL '5 days';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop triggers if exist
DROP TRIGGER IF EXISTS trigger_cleanup_denied_pireps_insert ON public.pireps;
DROP TRIGGER IF EXISTS trigger_cleanup_denied_pireps_update ON public.pireps;

-- Create triggers
CREATE TRIGGER trigger_cleanup_denied_pireps_insert
  AFTER INSERT ON public.pireps
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_cleanup_denied_pireps_insert();

CREATE TRIGGER trigger_cleanup_denied_pireps_update
  AFTER UPDATE ON public.pireps
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_cleanup_denied_pireps_update();

-- Schedule daily cleanup via pg_cron (runs at 3am UTC daily)
SELECT cron.schedule(
  'cleanup-denied-pireps-daily',
  '0 3 * * *',
  'SELECT public.cleanup_old_denied_pireps();'
);
