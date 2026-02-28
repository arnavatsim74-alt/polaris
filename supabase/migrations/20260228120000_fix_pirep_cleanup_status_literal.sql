-- Fix PIREP cleanup routines in case a previous migration used an invalid enum literal (`rejected`).
-- Using status::text comparison avoids enum-cast errors from mistyped literals.

CREATE OR REPLACE FUNCTION public.cleanup_old_denied_pireps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.pireps
  WHERE status::text = 'denied'
    AND submitted_at < now() - interval '5 days';
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_cleanup_denied_pireps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.cleanup_old_denied_pireps();
  RETURN NEW;
END;
$$;
