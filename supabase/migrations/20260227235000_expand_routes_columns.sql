-- Fix: Change aircraft_icao to VARCHAR(100) to allow multi-aircraft values
ALTER TABLE routes ALTER COLUMN aircraft_icao TYPE VARCHAR(100);

-- Also fix livery to support multiple liveries
ALTER TABLE routes ALTER COLUMN livery TYPE VARCHAR(100);
