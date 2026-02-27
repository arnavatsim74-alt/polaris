-- Auto-delete denied Pireps after 5 days using a trigger (no pg_cron required)
-- This trigger runs after each INSERT/UPDATE on pireps and cleans up old denied records

CREATE OR REPLACE FUNCTION public.cleanup_old_denied_pireps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.pireps
  WHERE status = 'denied'
    AND COALESCE(reviewed_at, created_at) < NOW() - INTERVAL '5 days';
END;
$$;

-- Create trigger to run cleanup after each PIREP insert/update
CREATE OR REPLACE FUNCTION public.trigger_cleanup_denied_pireps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Run cleanup but don't fail the main operation if it errors
  PERFORM public.cleanup_old_denied_pireps();
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS cleanup_denied_pireps_trigger ON public.pireps;

-- Create trigger that runs after insert or update
CREATE TRIGGER cleanup_denied_pireps_trigger
AFTER INSERT OR UPDATE ON public.pireps
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_cleanup_denied_pireps();

-- Also run cleanup now to clean existing records
SELECT public.cleanup_old_denied_pireps();
