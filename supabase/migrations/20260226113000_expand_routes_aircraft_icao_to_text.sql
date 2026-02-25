-- Allow storing multiple aircraft ICAOs in routes.aircraft_icao (e.g. "A320, B737")
ALTER TABLE public.routes
ALTER COLUMN aircraft_icao TYPE text USING aircraft_icao::text;
