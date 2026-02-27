import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, Plane, Award, ChevronsUpDown, Check } from "lucide-react";
import { splitRouteAircraft } from "@/lib/routeAircraft";

const EMPTY_AIRCRAFT: { icao_code: string | null; name: string | null; livery: string | null }[] = [];
const EMPTY_RANK_OPTIONS: { value: string; label: string }[] = [];

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

const normalizeRank = (rank: string): string | null => {
  const normalized = rank.toLowerCase().replace(/[\s_-]/g, "");
  const rankMap: Record<string, string> = {
    cadet: "cadet",
    firstofficer: "first_officer",
    fo: "first_officer",
    captain: "captain",
    cpt: "captain",
    seniorcaptain: "senior_captain",
    commander: "commander",
    cmd: "commander",
  };
  return rankMap[normalized] || null;
};

export function RouteImportMapping({ parsedRoutes, onComplete, onCancel }: RouteImportMappingProps) {
  const [aircraftMappings, setAircraftMappings] = useState<Record<string, { icao: string; livery: string }>>({});
  const [rankMappings, setRankMappings] = useState<Record<string, string>>({});
  const [activeAircraftCsv, setActiveAircraftCsv] = useState<string | null>(null);

  const aircraftQuery = useQuery({
    queryKey: ["aircraft-for-mapping"],
    queryFn: async () => {
      const { data } = await supabase.from("aircraft").select("*").order("name");
      return data || [];
    },
  });
  const aircraftRows = aircraftQuery.data ?? EMPTY_AIRCRAFT;

  const rankOptionsQuery = useQuery({
    queryKey: ["rank-configs-for-mapping"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rank_configs")
        .select("name, label")
        .eq("is_active", true)
        .order("order_index");
      return (data || []).map((rank) => ({ value: rank.name, label: rank.label }));
    },
  });
  const rankOptions = rankOptionsQuery.data ?? EMPTY_RANK_OPTIONS;

  const uniqueAircraftStrings = useMemo(
    () => [...new Set(parsedRoutes.flatMap((route) => splitRouteAircraft(route.aircraft_icao)))],
    [parsedRoutes]
  );

  const uniqueRanks = useMemo(
    () =>
      [
        ...new Set(parsedRoutes.map((route) => route.min_rank).filter(Boolean).filter((rank) => !normalizeRank(rank!))),
      ] as string[],
    [parsedRoutes]
  );

  const uniqueIcaoCodes = useMemo(() => {
    const codes = aircraftRows.map((aircraft) => aircraft.icao_code).filter(Boolean);
    return [...new Set(codes)] as string[];
  }, [aircraftRows]);

  const aircraftByIcao = useMemo(() => {
    const map: Record<string, { name: string; liveries: string[] }> = {};

    aircraftRows.forEach((aircraft) => {
      if (!aircraft.icao_code) return;

      if (!map[aircraft.icao_code]) {
        map[aircraft.icao_code] = {
          name: aircraft.name || aircraft.icao_code,
          liveries: [],
        };
      }

      if (aircraft.livery && !map[aircraft.icao_code].liveries.includes(aircraft.livery)) {
        map[aircraft.icao_code].liveries.push(aircraft.livery);
      }
    });

    return map;
  }, [aircraftRows]);

  const handleAircraftChange = (csvString: string, icaoCode: string) => {
    setAircraftMappings((previous) => ({
      ...previous,
      [csvString]: {
        icao: icaoCode,
        livery: previous[csvString]?.livery || "",
      },
    }));
  };

  const handleLiveryChange = (csvString: string, livery: string) => {
    setAircraftMappings((previous) => ({
      ...previous,
      [csvString]: {
        ...previous[csvString],
        livery,
      },
    }));
  };

  const handleRankChange = (csvRank: string, mappedRank: string) => {
    setRankMappings((previous) => ({
      ...previous,
      [csvRank]: mappedRank,
    }));
  };

  const handleFinalizeImport = () => {
    const mappedRoutes = parsedRoutes.map((route) => {
      const rawAircraftValues = splitRouteAircraft(route.aircraft_icao);
      const mappedAircraftValues = rawAircraftValues.map((value) => aircraftMappings[value]?.icao || value);

      const mappedLiveryValues = rawAircraftValues
        .map((value, index) => {
          const mappedIcao = mappedAircraftValues[index];
          const selectedLivery = aircraftMappings[value]?.livery || "";
          if (selectedLivery) return selectedLivery;

          const fallbackLivery = aircraftRows.find(
            (aircraft) =>
              String(aircraft.icao_code || "").toUpperCase() === String(mappedIcao || "").toUpperCase() &&
              aircraft.livery
          )?.livery;
          return fallbackLivery || "";
        })
        .filter(Boolean);

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

  const isAircraftMappingComplete = uniqueAircraftStrings.every((value) => aircraftMappings[value]?.icao);
  const isRankMappingComplete = uniqueRanks.every((value) => rankMappings[value]);
  const canFinalize =
    (uniqueAircraftStrings.length === 0 || isAircraftMappingComplete) &&
    (uniqueRanks.length === 0 || isRankMappingComplete);

  const activeSelectedIcao = activeAircraftCsv ? aircraftMappings[activeAircraftCsv]?.icao : undefined;

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Route Import Finalisation</CardTitle>
        <CardDescription>Map your CSV data to the system values</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {uniqueAircraftStrings.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Plane className="h-4 w-4" />
              <span>Map each aircraft from your CSV to an aircraft in the database:</span>
            </div>

            {uniqueAircraftStrings.map((csvString) => {
              const selectedIcao = aircraftMappings[csvString]?.icao;
              const selectedAircraft = selectedIcao ? aircraftByIcao[selectedIcao] : null;
              const liveries = selectedAircraft?.liveries || [];

              return (
                <div key={csvString} className="space-y-2 rounded-lg bg-muted/50 p-3">
                  <Label className="font-medium">"{csvString}"</Label>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => setActiveAircraftCsv(csvString)}
                  >
                    {selectedIcao
                      ? `${aircraftByIcao[selectedIcao]?.name || selectedIcao} (${selectedIcao})`
                      : "Select aircraft type"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>

                  {selectedIcao && liveries.length > 0 && (
                    <Select
                      value={aircraftMappings[csvString]?.livery || ""}
                      onValueChange={(value) => handleLiveryChange(csvString, value)}
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

        <Dialog open={Boolean(activeAircraftCsv)} onOpenChange={(open) => !open && setActiveAircraftCsv(null)}>
          <DialogContent className="p-0 sm:max-w-[500px]">
            <DialogHeader className="px-4 pb-1 pt-4">
              <DialogTitle>
                Select aircraft mapping{activeAircraftCsv ? ` for "${activeAircraftCsv}"` : ""}
              </DialogTitle>
            </DialogHeader>

            {activeAircraftCsv && (
              <Command>
                <CommandInput placeholder="Search aircraft..." />
                <CommandList>
                  <CommandEmpty>No aircraft found.</CommandEmpty>
                  <CommandGroup>
                    {uniqueIcaoCodes.map((icao) => (
                      <CommandItem
                        key={icao}
                        value={`${icao} ${aircraftByIcao[icao]?.name || ""}`}
                        onSelect={() => {
                          handleAircraftChange(activeAircraftCsv, icao);
                          setActiveAircraftCsv(null);
                        }}
                      >
                        <Check className={`mr-2 h-4 w-4 ${activeSelectedIcao === icao ? "opacity-100" : "opacity-0"}`} />
                        {aircraftByIcao[icao]?.name || icao} ({icao})
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
          </DialogContent>
        </Dialog>

        {uniqueAircraftStrings.length > 0 && uniqueRanks.length > 0 && <Separator />}

        {uniqueRanks.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Award className="h-4 w-4" />
              <span>Map each rank from your CSV to a system rank:</span>
            </div>

            {uniqueRanks.map((csvRank) => (
              <div key={csvRank} className="space-y-2 rounded-lg bg-muted/50 p-3">
                <Label className="font-medium">"{csvRank}"</Label>
                <Select value={rankMappings[csvRank] || ""} onValueChange={(value) => handleRankChange(csvRank, value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a rank" />
                  </SelectTrigger>
                  <SelectContent>
                    {rankOptions.map((rank) => (
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

        {uniqueAircraftStrings.length === 0 && uniqueRanks.length === 0 && (
          <div className="py-6 text-center text-muted-foreground">
            <CheckCircle className="mx-auto mb-4 h-12 w-12 text-primary" />
            <p>All data looks good! No additional mapping required.</p>
          </div>
        )}

        <div className="flex justify-center gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleFinalizeImport} disabled={!canFinalize}>
            Finalise Import
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">{parsedRoutes.length} routes ready to import</p>
      </CardContent>
    </Card>
  );
}
