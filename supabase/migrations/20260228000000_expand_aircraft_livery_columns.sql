-- Expand aircraft_icao and livery columns to support multi-aircraft values
ALTER TABLE routes ALTER COLUMN aircraft_icao TYPE VARCHAR(50);
ALTER TABLE routes ALTER COLUMN livery TYPE VARCHAR(100);
