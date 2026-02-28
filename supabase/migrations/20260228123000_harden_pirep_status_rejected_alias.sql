-- Emergency hardening for environments where a bad migration/function used
-- `rejected` against the `pirep_status` enum.
--
-- Strategy:
-- 1) Allow the legacy literal so existing bad function bodies stop crashing.
-- 2) Normalize any `rejected` data back to the canonical value `denied`.
-- 3) Guard all future writes so `rejected` is automatically rewritten to `denied`.

ALTER TYPE public.pirep_status ADD VALUE IF NOT EXISTS 'rejected';

UPDATE public.pireps
SET status = 'denied'
WHERE status::text = 'rejected';

CREATE OR REPLACE FUNCTION public.normalize_pirep_status_rejected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.status::text = 'rejected' THEN
    NEW.status := 'denied';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_pirep_status_rejected_trigger ON public.pireps;

CREATE TRIGGER normalize_pirep_status_rejected_trigger
BEFORE INSERT OR UPDATE ON public.pireps
FOR EACH ROW
EXECUTE FUNCTION public.normalize_pirep_status_rejected();
