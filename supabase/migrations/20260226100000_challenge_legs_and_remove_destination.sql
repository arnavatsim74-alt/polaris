-- Remove deprecated destination field from challenges
ALTER TABLE public.challenges DROP COLUMN IF EXISTS destination_icao;

-- Add challenge legs to support multi-leg world tours from routes table
CREATE TABLE IF NOT EXISTS public.challenge_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  leg_order INTEGER NOT NULL DEFAULT 1,
  leg_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenge_legs_challenge_id ON public.challenge_legs(challenge_id, leg_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_legs_unique_route_per_challenge ON public.challenge_legs(challenge_id, route_id);

ALTER TABLE public.challenge_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view challenge legs"
ON public.challenge_legs
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage challenge legs"
ON public.challenge_legs
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));
