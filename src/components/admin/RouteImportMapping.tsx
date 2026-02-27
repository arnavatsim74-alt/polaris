import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle, Plane, Award, ChevronsUpDown, Check } from "lucide-react";
import { splitRouteAircraft } from "@/lib/routeAircraft";

interface ParsedRoute {
  route_number: string;
  dep_icao: string;
  arr_icao: string;
  aircraft_icao?: string;
  livery?: string;
  route_type: string;
  est_flight_time_minutes: number;
  min_rank?: string;
  notes?: string;
}

interface RouteImportMappingProps {
  parsedRoutes: ParsedRoute[];
  onComplete: (mappedRoutes: ParsedRoute[]) => void;
  onCancel: () => void;
}

// Ranks fetched from DB in the component below

// Map common rank strings to system values
const normalizeRank = (rank: string): string | null => {
  const normalized = rank.toLowerCase().replace(/[\s_-]/g, "");
  const rankMap: Record<string, string> = {
    "cadet": "cadet",
    "firstofficer": "first_officer",
    "fo": "first_officer",
    "captain": "captain",
    "cpt": "captain",
    "seniorcaptain": "senior_captain",
    "commander": "commander",
    "cmd": "commander",
  };
  return rankMap[normalized] || null;
};

export function RouteImportMapping({ parsedRoutes, onComplete, onCancel }: RouteImportMappingProps) {
  // Memoize unique aircraft strings and ranks
  const uniqueAircraftStrings = useMemo(() => 
    [...new Set(parsedRoutes.flatMap((r) => splitRouteAircraft(r.aircraft_icao)))],
    [parsedRoutes]
  );
  
  const uniqueRanks = useMemo(() => [...new Set(
    parsedRoutes
      .map(r => r.min_rank)
      .filter(Boolean)
      .filter(rank => !normalizeRank(rank!))
  )] as string[], [parsedRoutes]);

  // Memoize unique ICAO codes (deduplicated)
  const uniqueIcaoCodes = useMemo(() => {
    const codes = aircraft?.map(a => a.icao_code).filter(Boolean) || [];
    return [...new Set(codes)] as string[];
  }, [aircraft]);

  // Memoize aircraft lookup map
  const aircraftByIcao = useMemo(() => {
    const map: Record<string, { name: string; liveries: string[] }> = {};
    aircraft?.forEach(ac => {
      if (ac.icao_code) {
        if (!map[ac.icao_code]) {
          map[ac.icao_code] = { name: ac.name || ac.icao_code, liveries: [] };
        }
        if (ac.livery && !map[ac.icao_code].liveries.includes(ac.livery)) {
          map[ac.icao_code].liveries.push(ac.livery);
        }
      }
    });
    return map;
  }, [aircraft]);

  // Mappings state
  const [aircraftMappings, setAircraftMappings] = useState<Record<string, { icao: string; livery: string }>>({});
  const [rankMappings, setRankMappings] = useState<Record<string, string>>({});

  // Fetch aircraft from database
  const { data: aircraft } = useQuery({
    queryKey: ["aircraft-for-mapping"],
    queryFn: async () => {
      const { data } = await supabase.from("aircraft").select("*").order("name");
      return data || [];
    },
  });

  // Fetch ranks from database
  const { data: rankOptions } = useQuery({
    queryKey: ["rank-configs-for-mapping"],
    queryFn: async () => {
      const { data } = await supabase.from("rank_configs").select("name, label").eq("is_active", true).order("order_index");
      return (data || []).map(r => ({ value: r.name, label: r.label }));
    },
  });

  const handleAircraftChange = (csvString: string, icaoCode: string) => {
    setAircraftMappings(prev => ({
      ...prev,
      [csvString]: { icao: icaoCode, livery: prev[csvString]?.livery || "" }
    }));
  };

  const handleLiveryChange = (csvString: string, livery: string) => {
    setAircraftMappings(prev => ({
      ...prev,
      [csvString]: { ...prev[csvString], livery }
    }));
  };

  const handleRankChange = (csvRank: string, mappedRank: string) => {
    setRankMappings(prev => ({
      ...prev,
      [csvRank]: mappedRank
    }));
  };

  const handleFinalizeImport = () => {
    const mappedRoutes = parsedRoutes.map(route => {
      const rawAircraftValues = splitRouteAircraft(route.aircraft_icao);
      const mappedAircraftValues = rawAircraftValues.map((value) => aircraftMappings[value]?.icao || value);
      const mappedLiveryValues = rawAircraftValues
        .map((value, index) => {
          const mappedIcao = mappedAircraftValues[index];
          const selectedLivery = aircraftMappings[value]?.livery || "";
          if (selectedLivery) return selectedLivery;

          const fallbackLivery = aircraft
            ?.find((ac) => String(ac.icao_code || "").toUpperCase() === String(mappedIcao || "").toUpperCase() && ac.livery)
            ?.livery;
          return fallbackLivery || "";
        })
        .filter(Boolean);
      
      // Get rank - try auto-mapping first, then user mapping
      let finalRank = "cadet";
      if (route.min_rank) {
        const autoMapped = normalizeRank(route.min_rank);
        finalRank = autoMapped || rankMappings[route.min_rank] || "cadet";
      }

      return {
        ...route,
        aircraft_icao: mappedAircraftValues.length > 0 ? mappedAircraftValues.join(", ") : route.aircraft_icao,
        livery: mappedLiveryValues.length > 0 ? mappedLiveryValues.join(", ") : route.livery || undefined,
        min_rank: finalRank,
      };
    });
    onComplete(mappedRoutes);
  };

  const isAircraftMappingComplete = uniqueAircraftStrings.every(str => aircraftMappings[str]?.icao);
  const isRankMappingComplete = uniqueRanks.every(rank => rankMappings[rank]);
  const canFinalize = (uniqueAircraftStrings.length === 0 || isAircraftMappingComplete) && 
                      (uniqueRanks.length === 0 || isRankMappingComplete);

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Route Import Finalisation</CardTitle>
        <CardDescription>Map your CSV data to the system values</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Aircraft Mapping Section */}
        {uniqueAircraftStrings.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Plane className="h-4 w-4" />
              <span>Map each aircraft from your CSV to an aircraft in the database:</span>
            </div>
            
            {uniqueAircraftStrings.map((csvString) => {
              const selectedIcao = aircraftMappings[csvString]?.icao;
              const aircraftData = selectedIcao ? aircraftByIcao[selectedIcao] : null;
              const liveries = aircraftData?.liveries || [];
              
              return (
                <div key={csvString} className="space-y-2 p-3 bg-muted/50 rounded-lg">
                  <Label className="font-medium">"{csvString}"</Label>
                  
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                      >
                        {selectedIcao 
                          ? `${aircraftByIcao[selectedIcao]?.name || selectedIcao} (${selectedIcao})`
                          : "Select aircraft type"
                        }
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[400px]" side="bottom" align="start">
                      <Command>
                        <CommandInput placeholder="Search aircraft..." />
                        <CommandList>
                          <CommandEmpty>No aircraft found.</CommandEmpty>
                          <CommandGroup>
                            {uniqueIcaoCodes.map((icao) => (
                              <CommandItem
                                key={icao}
                                value={`${icao} ${aircraftByIcao[icao]?.name || ""}`}
                                onSelect={() => handleAircraftChange(csvString, icao)}
                              >
                                <Check
                                  className={`mr-2 h-4 w-4 ${selectedIcao === icao ? "opacity-100" : "opacity-0"}`}
                                />
                                {aircraftByIcao[icao]?.name || icao} ({icao})
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  
                  {selectedIcao && liveries.length > 0 && (
                    <Select
                      value={aircraftMappings[csvString]?.livery || ""}
                      onValueChange={(v) => handleLiveryChange(csvString, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a livery (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {liveries.map((livery) => (
                          <SelectItem key={livery} value={livery}>
                            {livery}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {uniqueAircraftStrings.length > 0 && uniqueRanks.length > 0 && <Separator />}

        {/* Rank Mapping Section - only for ranks that couldn't be auto-mapped */}
        {uniqueRanks.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Award className="h-4 w-4" />
              <span>Map each rank from your CSV to a system rank:</span>
            </div>
            
            {uniqueRanks.map((csvRank) => (
              <div key={csvRank} className="space-y-2 p-3 bg-muted/50 rounded-lg">
                <Label className="font-medium">"{csvRank}"</Label>
                <Select
                  value={rankMappings[csvRank] || ""}
                  onValueChange={(v) => handleRankChange(csvRank, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a rank" />
                  </SelectTrigger>
                  <SelectContent>
                    {(rankOptions || []).map((rank) => (
                      <SelectItem key={rank.value} value={rank.value}>
                        {rank.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        {/* No mappings needed */}
        {uniqueAircraftStrings.length === 0 && uniqueRanks.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-primary" />
            <p>All data looks good! No additional mapping required.</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 justify-center pt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleFinalizeImport}
            disabled={!canFinalize}
          >
            Finalise Import
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          {parsedRoutes.length} routes ready to import
        </p>
      </CardContent>
    </Card>
  );
}
