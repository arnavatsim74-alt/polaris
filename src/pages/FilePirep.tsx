import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, Plane } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const defaultOperators = [
  "Aeroflot", "Azerbaijan Airlines", "Uzbekistan Airways", "Belavia",
  "S7 Airlines", "AirBridge Cargo", "Saudia", "Emirates", "Fly Dubai",
  "Emirates SkyCargo", "Aegean Airlines", "Qatar Airways",
  "SunCountry Airlines", "IndiGo", "Oman Air", "Others",
];

export default function FilePirep() {
  const { pilot } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [flightNumber, setFlightNumber] = useState("");
  const [depIcao, setDepIcao] = useState("");
  const [arrIcao, setArrIcao] = useState("");
  const [aircraftIcao, setAircraftIcao] = useState("");
  const [flightHours, setFlightHours] = useState("");
  const [flightDate, setFlightDate] = useState<Date | undefined>(new Date());
  const [selectedMultiplier, setSelectedMultiplier] = useState("1");
  const [operator, setOperator] = useState("");
  const [flightType, setFlightType] = useState<"passenger" | "cargo">("passenger");
  const [pax, setPax] = useState("");
  const [cargoKg, setCargoKg] = useState("");
  const [showAllAircraft, setShowAllAircraft] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAcarsLoading, setIsAcarsLoading] = useState(false);

  // Pre-fill from URL params (from Routes / ROTW "File PIREP" buttons)
  useEffect(() => {
    const dep = searchParams.get("dep");
    const arr = searchParams.get("arr");
    const ac = searchParams.get("aircraft");
    const fn = searchParams.get("flight");
    const ft = searchParams.get("type");
    if (dep) setDepIcao(dep);
    if (arr) setArrIcao(arr);
    if (ac) setAircraftIcao(ac);
    if (fn) setFlightNumber(fn);
    if (ft && (ft === "passenger" || ft === "cargo")) setFlightType(ft);
  }, [searchParams]);

  // Check if filing from event or ROTW (bypass aircraft restrictions)
  const isEventOrRotw = searchParams.has("event") || searchParams.has("rotw");

  // Fetch operators from site_settings (fallback to defaults)
  const { data: operators } = useQuery({
    queryKey: ["pirep-operators"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "pirep_operators").maybeSingle();
      if (data?.value) {
        try { return JSON.parse(data.value) as string[]; } catch { return defaultOperators; }
      }
      return defaultOperators;
    },
  });

  const { data: aircraft } = useQuery({
    queryKey: ["aircraft"],
    queryFn: async () => {
      const { data } = await supabase
        .from("aircraft")
        .select("id,icao_code,name,livery")
        .order("name");
      return data || [];
    },
  });

  // Fetch rank configs for aircraft unlock restrictions
  const { data: rankConfigs } = useQuery({
    queryKey: ["rank-configs-all"],
    queryFn: async () => {
      const { data } = await supabase.from("rank_configs").select("*").eq("is_active", true).order("order_index");
      return data || [];
    },
  });

  // Get unlocked aircraft for pilot's current rank
  const unlockedAircraftIcaos = (() => {
    if (!rankConfigs || !pilot?.current_rank) return null;
    const pilotRank = rankConfigs.find(r => r.name === pilot.current_rank);
    if (!pilotRank) return null;

    const unlocked = new Set<string>();
    for (const rank of rankConfigs) {
      if (rank.order_index <= pilotRank.order_index) {
        const ac = (rank as any).aircraft_unlocks;
        if (Array.isArray(ac)) ac.forEach((i: string) => unlocked.add(String(i).trim().toUpperCase()));
      }
    }

    return unlocked.size > 0 ? Array.from(unlocked) : null;
  })();

  // Get unique aircraft by icao_code (deduplicate for the dropdown)
  const getUniqueAircraft = (list: typeof aircraft) => {
    if (!list) return [];
    const seen = new Set<string>();
    return list.filter(ac => {
      const icaoCode = String(ac.icao_code || "").trim().toUpperCase();
      if (!icaoCode || seen.has(icaoCode)) return false;
      seen.add(icaoCode);
      return true;
    });
  };

  const availableAircraft = useMemo(
    () => getUniqueAircraft(
      (!isEventOrRotw && !showAllAircraft && unlockedAircraftIcaos)
        ? aircraft?.filter(ac => unlockedAircraftIcaos.includes(String(ac.icao_code || "").toUpperCase()))
        : aircraft
    ),
    [aircraft, isEventOrRotw, showAllAircraft, unlockedAircraftIcaos]
  );

  const { data: multipliers } = useQuery({
    queryKey: ["multiplier-configs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("multiplier_configs")
        .select("*")
        .eq("is_active", true)
        .order("value");
      return data || [];
    },
  });

  const currentMultiplierValue = parseFloat(selectedMultiplier) || 1;


  const handleLoadAcars = async () => {
    if (!pilot?.ifc_username) {
      toast.error("Set your IFC username in Profile Settings first.");
      return;
    }

    setIsAcarsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-pirep-if", {
        body: { ifc_identifier: pilot.ifc_username, latest_only: true },
      });

      if (error) throw error;

      const latestFlight = data?.latestFlight;
      if (!latestFlight) {
        toast.error("No recent Infinite Flight log found.");
        return;
      }

      if (latestFlight.callsign) setFlightNumber(String(latestFlight.callsign).toUpperCase());
      if (latestFlight.originAirport) setDepIcao(String(latestFlight.originAirport).toUpperCase());
      if (latestFlight.destinationAirport) setArrIcao(String(latestFlight.destinationAirport).toUpperCase());
      if (latestFlight.created) setFlightDate(new Date(latestFlight.created));
      if (typeof latestFlight.totalTime === "number") {
        const hours = latestFlight.totalTime > 24 ? latestFlight.totalTime / 3600 : latestFlight.totalTime;
        if (Number.isFinite(hours) && hours > 0) setFlightHours(hours.toFixed(1));
      }

      toast.success("ACARS loaded from your latest flight log.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to load ACARS data");
    } finally {
      setIsAcarsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pilot?.id) { toast.error("Pilot profile not found"); return; }
    if (!flightNumber || !depIcao || !arrIcao || !aircraftIcao || !flightHours || !flightDate || !operator) {
      toast.error("Please fill in all required fields"); return;
    }

    // Check aircraft is unlocked for the pilot (unless event/ROTW)
    if (!isEventOrRotw && !showAllAircraft && unlockedAircraftIcaos && !unlockedAircraftIcaos.includes(aircraftIcao.toUpperCase())) {
      toast.error("This aircraft is not unlocked for your rank"); return;
    }

    const hours = parseFloat(flightHours);
    const paxValue = pax.trim() === "" ? null : Number(pax);
    const cargoKgValue = cargoKg.trim() === "" ? null : Number(cargoKg);

    if (isNaN(hours) || hours <= 0 || hours > 24) {
      toast.error("Please enter valid flight hours (0-24)"); return;
    }

    if (paxValue !== null && (!Number.isInteger(paxValue) || paxValue < 0)) {
      toast.error("PAX must be a whole number of 0 or greater"); return;
    }

    if (cargoKgValue !== null && (!Number.isFinite(cargoKgValue) || cargoKgValue < 0)) {
      toast.error("Cargo must be a number of 0 or greater"); return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.from("pireps").insert({
        pilot_id: pilot.id,
        flight_number: flightNumber.toUpperCase(),
        dep_icao: depIcao.toUpperCase(),
        arr_icao: arrIcao.toUpperCase(),
        aircraft_icao: aircraftIcao,
        flight_hours: hours,
        flight_date: format(flightDate, "yyyy-MM-dd"),
        multiplier: currentMultiplierValue,
        operator,
        flight_type: flightType,
        pax: paxValue,
        cargo_kg: cargoKgValue,
      });
      if (error) throw error;

      // Send Discord webhook notification for new PIREP
      try {
        await supabase.functions.invoke("discord-rank-notification", {
          body: {
            type: "new_pirep",
            pilot_name: pilot.full_name,
            pid: pilot.pid,
            flight_number: flightNumber.toUpperCase(),
            dep_icao: depIcao.toUpperCase(),
            arr_icao: arrIcao.toUpperCase(),
            aircraft_icao: aircraftIcao,
            flight_hours: hours,
            operator,
            flight_type: flightType,
            pax: paxValue,
            cargo_kg: cargoKgValue,
          },
        });
      } catch (discordErr) {
        console.error("Discord notification failed:", discordErr);
      }

      toast.success("PIREP submitted successfully!");
      navigate("/pirep-history");
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit PIREP");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plane className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>File PIREP</CardTitle>
              <CardDescription>Submit a new pilot report for your flight</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <Button type="button" variant="outline" onClick={handleLoadAcars} disabled={isLoading || isAcarsLoading} className="w-full md:w-auto">
              {(isAcarsLoading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              ACARS
            </Button>
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">Flight Details</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="flightNumber">Flight Number *</Label>
                  <Input id="flightNumber" placeholder="AFL1234" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} disabled={isLoading} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="flightDate">Flight Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !flightDate && "text-muted-foreground")} disabled={isLoading}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {flightDate ? format(flightDate, "PPP") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={flightDate} onSelect={setFlightDate} disabled={(date) => date > new Date()} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="depIcao">Departure ICAO *</Label>
                  <Input id="depIcao" placeholder="UUEE" maxLength={4} value={depIcao} onChange={(e) => setDepIcao(e.target.value.toUpperCase())} disabled={isLoading} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="arrIcao">Arrival ICAO *</Label>
                  <Input id="arrIcao" placeholder="EGLL" maxLength={4} value={arrIcao} onChange={(e) => setArrIcao(e.target.value.toUpperCase())} disabled={isLoading} required />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">Aircraft & Duration</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="aircraft">Aircraft Type *</Label>
                  <Select value={aircraftIcao} onValueChange={setAircraftIcao} disabled={isLoading}>
                    <SelectTrigger><SelectValue placeholder="Select aircraft" /></SelectTrigger>
                    <SelectContent>
                      {availableAircraft?.map((ac) => (
                        <SelectItem key={ac.icao_code} value={String(ac.icao_code).toUpperCase()}>
                          {ac.name}{ac.livery ? ` (${ac.livery})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!isEventOrRotw && (
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        id="rotw-fr-e"
                        checked={showAllAircraft}
                        onCheckedChange={(checked) => setShowAllAircraft(Boolean(checked))}
                        disabled={isLoading}
                      />
                      <Label htmlFor="rotw-fr-e" className="text-xs font-normal text-muted-foreground">
                        ROTW/FR/E (show all aircraft irrespective of rank)
                      </Label>
                    </div>
                  )}
                  {!isEventOrRotw && !showAllAircraft && unlockedAircraftIcaos && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Aircraft restricted by your rank. Events & ROTW flights bypass restrictions.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="flightHours">Flight Hours *</Label>
                  <Input id="flightHours" type="number" step="0.1" min="0.1" max="24" placeholder="2.5" value={flightHours} onChange={(e) => setFlightHours(e.target.value)} disabled={isLoading} required />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">Operator & Classification</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="operator">Operator *</Label>
                  <Select value={operator} onValueChange={setOperator} disabled={isLoading}>
                    <SelectTrigger><SelectValue placeholder="Select operator" /></SelectTrigger>
                    <SelectContent>
                      {(operators || defaultOperators).map((op) => (
                        <SelectItem key={op} value={op}>{op}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="flightType">Flight Type *</Label>
                  <Select value={flightType} onValueChange={(v) => setFlightType(v as "passenger" | "cargo")} disabled={isLoading}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="passenger">Passenger</SelectItem>
                      <SelectItem value="cargo">Cargo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pax">PAX</Label>
                  <Input
                    id="pax"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="180"
                    value={pax}
                    onChange={(e) => setPax(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cargoKg">Cargo (kg)</Label>
                  <Input
                    id="cargoKg"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="2500"
                    value={cargoKg}
                    onChange={(e) => setCargoKg(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="multiplier">Hours Multiplier</Label>
              <Select value={selectedMultiplier} onValueChange={setSelectedMultiplier} disabled={isLoading}>
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {multipliers && multipliers.length > 0 ? (
                    multipliers.map((m) => (
                      <SelectItem key={m.id} value={String(m.value)}>
                        {m.name} ({Number(m.value).toFixed(1)}x)
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="1">Standard (1.0x)</SelectItem>
                      <SelectItem value="1.5">1.5x</SelectItem>
                      <SelectItem value="2">2.0x</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Effective hours: {(parseFloat(flightHours || "0") * currentMultiplierValue).toFixed(1)}
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit PIREP
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
