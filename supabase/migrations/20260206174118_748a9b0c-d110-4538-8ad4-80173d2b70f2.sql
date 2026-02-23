-- Create enums for the application
CREATE TYPE public.app_role AS ENUM ('admin', 'pilot');
CREATE TYPE public.pirep_status AS ENUM ('pending', 'approved', 'denied', 'on_hold');
CREATE TYPE public.application_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.pilot_rank AS ENUM ('cadet', 'first_officer', 'captain', 'senior_captain', 'commander');
CREATE TYPE public.flight_type AS ENUM ('passenger', 'cargo');

-- User roles table (for admin access - separate from profiles per security guidelines)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Pilots table (profiles for approved pilots)
CREATE TABLE public.pilots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    pid VARCHAR(10) NOT NULL UNIQUE, -- AFLVxxxx format
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    total_hours DECIMAL(10, 2) DEFAULT 0,
    total_pireps INTEGER DEFAULT 0,
    current_rank pilot_rank DEFAULT 'cadet',
    vatsim_id TEXT,
    ivao_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.pilots ENABLE ROW LEVEL SECURITY;

-- Pilot applications table
CREATE TABLE public.pilot_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    vatsim_id TEXT,
    ivao_id TEXT,
    experience_level TEXT NOT NULL,
    preferred_simulator TEXT NOT NULL,
    reason_for_joining TEXT NOT NULL,
    status application_status DEFAULT 'pending',
    assigned_pid VARCHAR(10),
    rejection_reason TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.pilot_applications ENABLE ROW LEVEL SECURITY;

-- Aircraft fleet table
CREATE TABLE public.aircraft (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icao_code VARCHAR(4) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- e.g., "Narrow-body", "Wide-body"
    passenger_capacity INTEGER,
    cargo_capacity_kg INTEGER,
    range_nm INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.aircraft ENABLE ROW LEVEL SECURITY;

-- Routes table
CREATE TABLE public.routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_number VARCHAR(20) NOT NULL UNIQUE,
    dep_icao VARCHAR(4) NOT NULL,
    arr_icao VARCHAR(4) NOT NULL,
    aircraft_icao VARCHAR(4) REFERENCES public.aircraft(icao_code),
    route_type flight_type NOT NULL,
    est_flight_time_minutes INTEGER NOT NULL,
    min_rank pilot_rank DEFAULT 'cadet',
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

-- PIREPs table
CREATE TABLE public.pireps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pilot_id UUID REFERENCES public.pilots(id) ON DELETE CASCADE NOT NULL,
    flight_number VARCHAR(20) NOT NULL,
    dep_icao VARCHAR(4) NOT NULL,
    arr_icao VARCHAR(4) NOT NULL,
    aircraft_icao VARCHAR(4) NOT NULL,
    flight_hours DECIMAL(5, 2) NOT NULL,
    flight_date DATE NOT NULL,
    multiplier DECIMAL(3, 1) DEFAULT 1.0,
    operator TEXT NOT NULL,
    flight_type flight_type NOT NULL,
    status pirep_status DEFAULT 'pending',
    status_reason TEXT,
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.pireps ENABLE ROW LEVEL SECURITY;

-- Events table
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    banner_url TEXT,
    server TEXT NOT NULL, -- VATSIM, IVAO, Offline
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    dep_icao VARCHAR(4) NOT NULL,
    arr_icao VARCHAR(4) NOT NULL,
    available_dep_gates TEXT[], -- Array of gate names
    available_arr_gates TEXT[], -- Array of gate names
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Event registrations table
CREATE TABLE public.event_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
    pilot_id UUID REFERENCES public.pilots(id) ON DELETE CASCADE NOT NULL,
    assigned_dep_gate TEXT,
    assigned_arr_gate TEXT,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, pilot_id)
);

ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

-- PIREP streak tracking
CREATE TABLE public.pilot_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pilot_id UUID REFERENCES public.pilots(id) ON DELETE CASCADE NOT NULL UNIQUE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_pirep_date DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.pilot_streaks ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- User roles: users can view their own roles, admins can view all
CREATE POLICY "Users can view own roles" ON public.user_roles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles" ON public.user_roles
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Pilots: public read, users can update own, admins can manage all
CREATE POLICY "Anyone authenticated can view pilots" ON public.pilots
    FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Users can update own pilot profile" ON public.pilots
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage pilots" ON public.pilots
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Applications: users can view/create own, admins can manage all
CREATE POLICY "Users can view own application" ON public.pilot_applications
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own application" ON public.pilot_applications
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage applications" ON public.pilot_applications
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Aircraft: everyone can view
CREATE POLICY "Anyone can view aircraft" ON public.aircraft
    FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Admins can manage aircraft" ON public.aircraft
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Routes: everyone can view active, admins can manage all
CREATE POLICY "Anyone can view active routes" ON public.routes
    FOR SELECT TO authenticated USING (is_active = TRUE);

CREATE POLICY "Admins can manage routes" ON public.routes
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- PIREPs: users can view/create own, admins can manage all
CREATE POLICY "Users can view own pireps" ON public.pireps
    FOR SELECT USING (pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "Users can create own pireps" ON public.pireps
    FOR INSERT WITH CHECK (pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage all pireps" ON public.pireps
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Events: everyone can view active, admins can manage
CREATE POLICY "Anyone can view active events" ON public.events
    FOR SELECT TO authenticated USING (is_active = TRUE);

CREATE POLICY "Admins can manage events" ON public.events
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Event registrations: users can view/manage own, admins can view all
CREATE POLICY "Users can view own registrations" ON public.event_registrations
    FOR SELECT USING (pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "Users can create own registrations" ON public.event_registrations
    FOR INSERT WITH CHECK (pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage registrations" ON public.event_registrations
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Pilot streaks: users can view own, system updates
CREATE POLICY "Users can view own streaks" ON public.pilot_streaks
    FOR SELECT USING (pilot_id IN (SELECT id FROM public.pilots WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage streaks" ON public.pilot_streaks
    FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Function to update pilot rank based on hours
CREATE OR REPLACE FUNCTION public.calculate_rank(hours DECIMAL)
RETURNS pilot_rank
LANGUAGE plpgsql
AS $$
BEGIN
    IF hours >= 200 THEN
        RETURN 'commander';
    ELSIF hours >= 100 THEN
        RETURN 'senior_captain';
    ELSIF hours >= 50 THEN
        RETURN 'captain';
    ELSIF hours >= 25 THEN
        RETURN 'first_officer';
    ELSE
        RETURN 'cadet';
    END IF;
END;
$$;

-- Function to update pilot stats when PIREP is approved
CREATE OR REPLACE FUNCTION public.update_pilot_stats_on_pirep()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_hours DECIMAL;
    hours_to_add DECIMAL;
BEGIN
    -- Only process when status changes to approved
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        hours_to_add := NEW.flight_hours * NEW.multiplier;
        
        UPDATE public.pilots
        SET 
            total_hours = total_hours + hours_to_add,
            total_pireps = total_pireps + 1,
            current_rank = public.calculate_rank(total_hours + hours_to_add),
            updated_at = NOW()
        WHERE id = NEW.pilot_id
        RETURNING total_hours INTO new_hours;
    END IF;
    
    -- Handle reverting approved PIREPs
    IF OLD.status = 'approved' AND NEW.status != 'approved' THEN
        hours_to_add := OLD.flight_hours * OLD.multiplier;
        
        UPDATE public.pilots
        SET 
            total_hours = GREATEST(0, total_hours - hours_to_add),
            total_pireps = GREATEST(0, total_pireps - 1),
            current_rank = public.calculate_rank(GREATEST(0, total_hours - hours_to_add)),
            updated_at = NOW()
        WHERE id = OLD.pilot_id;
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_pilot_stats_trigger
    AFTER UPDATE ON public.pireps
    FOR EACH ROW
    EXECUTE FUNCTION public.update_pilot_stats_on_pirep();

-- Function to get next available PID
CREATE OR REPLACE FUNCTION public.get_next_pid()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    last_num INTEGER;
    new_pid TEXT;
BEGIN
    SELECT COALESCE(MAX(SUBSTRING(pid FROM 5)::INTEGER), 0) + 1 INTO last_num
    FROM public.pilots;
    
    new_pid := 'AFLV' || LPAD(last_num::TEXT, 4, '0');
    RETURN new_pid;
END;
$$;

-- Seed initial aircraft fleet
INSERT INTO public.aircraft (icao_code, name, type, passenger_capacity, cargo_capacity_kg, range_nm) VALUES
('A320', 'Airbus A320', 'Narrow-body', 180, 2000, 3300),
('A321', 'Airbus A321', 'Narrow-body', 220, 2500, 3200),
('A330', 'Airbus A330', 'Wide-body', 300, 5000, 6350),
('A350', 'Airbus A350', 'Wide-body', 350, 6000, 8000),
('B737', 'Boeing 737', 'Narrow-body', 170, 2000, 3000),
('B747', 'Boeing 747', 'Wide-body', 400, 12000, 7800),
('B777', 'Boeing 777', 'Wide-body', 380, 8000, 7500),
('B787', 'Boeing 787', 'Wide-body', 290, 5000, 7355),
('A380', 'Airbus A380', 'Wide-body', 550, 15000, 8000),
('E190', 'Embraer E190', 'Regional', 100, 1200, 2400);