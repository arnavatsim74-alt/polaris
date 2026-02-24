import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Route, Search, Plane, FileText, Lock } from "lucide-react";

const rankLabels: Record<string, string> = {
  cadet: "Cadet",
  first_officer: "First Officer",
  captain: "Captain",
  senior_captain: "Senior Captain",
  commander: "Commander",
};

export default function RoutesPage() {
  const { pilot } = useAuth();
  const navigate = useNavigate();
  const PAGE_SIZE = 50;
  const [depFilter, setDepFilter] = useState("");
  const [arrFilter, setArrFilter] = useState("");
  const [aircraftFilter, setAircraftFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Rank order for comparison
  const rankOrder = ["cadet", "first_officer", "captain", "senior_captain", "commander"];

  const pilotRankIndex = rankOrder.indexOf(pilot?.current_rank || "cadet");

  const canFlyRoute = (minRank: string | null) => {
    if (!minRank) return true;
    const routeRankIndex = rankOrder.indexOf(minRank);
    return pilotRankIndex >= routeRankIndex;
  };

  const { data: routes, isLoading } = useQuery({
    queryKey: ["routes"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetchAllRows");
      return fetchAllRows("routes", {
        filters: (q: any) => q.eq("is_active", true),
        orderColumn: "route_number",
      });
    },
  });

  const { data: aircraft } = useQuery({
    queryKey: ["routes-aircraft-filter-options"],
    queryFn: async () => {
      const { data } = await supabase.from("aircraft").select("icao_code").order("icao_code");
      const uniqueCodes = Array.from(
        new Set((data || []).map((ac) => ac.icao_code).filter(Boolean))
      );
      return uniqueCodes;
    },
  });

  const { data: recentPireps } = useQuery({
    queryKey: ["pilot-recent-approved-pireps", pilot?.id],
    queryFn: async () => {
      if (!pilot?.id) return [];
      const { data } = await supabase
        .from("pireps")
        .select("dep_icao, arr_icao, aircraft_icao")
        .eq("pilot_id", pilot.id)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(40);
      return data || [];
    },
    enabled: !!pilot?.id,
  });

  const filteredRoutes = routes?.filter((route) => {
    const matchesDep = depFilter === "" || route.dep_icao.includes(depFilter.toUpperCase());
    const matchesArr = arrFilter === "" || route.arr_icao.includes(arrFilter.toUpperCase());
    const matchesAircraft = aircraftFilter === "all" || String(route.aircraft_icao || "").trim().toUpperCase() === aircraftFilter;
    const matchesType = typeFilter === "all" || route.route_type === typeFilter;
    return matchesDep && matchesArr && matchesAircraft && matchesType;
  });

  const totalPages = Math.max(1, Math.ceil((filteredRoutes?.length || 0) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRoutes = (filteredRoutes || []).slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [depFilter, arrFilter, aircraftFilter, typeFilter]);

  const recommendedRoutes = useMemo(() => {
    if (!routes?.length || !pilot) return [] as typeof routes;

    const depCount = new Map<string, number>();
    const arrCount = new Map<string, number>();
    const aircraftCount = new Map<string, number>();

    for (const p of recentPireps || []) {
      if (p.dep_icao) depCount.set(p.dep_icao, (depCount.get(p.dep_icao) || 0) + 1);
      if (p.arr_icao) arrCount.set(p.arr_icao, (arrCount.get(p.arr_icao) || 0) + 1);
      if (p.aircraft_icao) aircraftCount.set(p.aircraft_icao, (aircraftCount.get(p.aircraft_icao) || 0) + 1);
    }

    return [...routes]
      .filter((r) => r.is_active && canFlyRoute(r.min_rank))
      .map((r) => {
        const depScore = depCount.get(r.dep_icao) || 0;
        const arrScore = arrCount.get(r.arr_icao) || 0;
        const acScore = aircraftCount.get(r.aircraft_icao || "") || 0;
        const rankScore = r.min_rank === pilot.current_rank ? 2 : 0;
        const totalScore = depScore * 2 + arrScore * 2 + acScore * 3 + rankScore;
        return { ...r, _score: totalScore };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, 6);
  }, [routes, recentPireps, pilot]);

  const formatFlightTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, "0")}`;
  };

  const handleFilePirep = (route: any) => {
    navigate(`/file-pirep?dep=${route.dep_icao}&arr=${route.arr_icao}&aircraft=${route.aircraft_icao || ""}&flight=${route.route_number}&type=${route.route_type}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Route className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Route Database</h1>
          <p className="text-muted-foreground">Browse available routes and file PIREPs</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Departure</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="ICAO"
                  value={depFilter}
                  onChange={(e) => setDepFilter(e.target.value)}
                  className="pl-9"
                  maxLength={4}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Arrival</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="ICAO"
                  value={arrFilter}
                  onChange={(e) => setArrFilter(e.target.value)}
                  className="pl-9"
                  maxLength={4}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Aircraft</label>
              <Select value={aircraftFilter} onValueChange={setAircraftFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Aircraft</SelectItem>
                  {aircraft?.map((icaoCode) => (
                    <SelectItem key={icaoCode} value={icaoCode}>
                      {icaoCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="passenger">Passenger</SelectItem>
                  <SelectItem value="cargo">Cargo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setDepFilter("");
                  setArrFilter("");
                  setAircraftFilter("all");
                  setTypeFilter("all");
                  setPage(1);
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {recommendedRoutes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recommended for You</CardTitle>
            <CardDescription>Based on your recent approved flights, rank, and aircraft preference</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {recommendedRoutes.map((route) => (
                <div key={`rec-${route.id}`} className="rounded-md border p-3">
                  <p className="font-semibold">{route.route_number}</p>
                  <p className="text-sm text-muted-foreground">{route.dep_icao} → {route.arr_icao} • {route.aircraft_icao}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => handleFilePirep(route)}>
                    <FileText className="h-3 w-3 mr-1" /> File PIREP
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Routes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Available Routes</CardTitle>
          <CardDescription>
            {filteredRoutes?.length || 0} routes found • Page {safePage} of {totalPages}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredRoutes && filteredRoutes.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Route</th>
                    <th className="text-left py-3 px-2 font-medium">Departure</th>
                    <th className="text-left py-3 px-2 font-medium">Arrival</th>
                    <th className="text-left py-3 px-2 font-medium">Aircraft</th>
                    <th className="text-left py-3 px-2 font-medium">Type</th>
                    <th className="text-left py-3 px-2 font-medium">Est. Time</th>
                    <th className="text-left py-3 px-2 font-medium">Min Rank</th>
                    <th className="text-left py-3 px-2 font-medium">Notes</th>
                    <th className="text-right py-3 px-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRoutes.map((route) => (
                    <tr key={route.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-2 font-medium">{route.route_number}</td>
                      <td className="py-3 px-2 font-mono">{route.dep_icao}</td>
                      <td className="py-3 px-2 font-mono">{route.arr_icao}</td>
                      <td className="py-3 px-2">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1">
                            <Plane className="h-3 w-3 text-muted-foreground" />
                            {route.aircraft_icao}
                          </div>
                          {route.livery && (
                            <span className="text-xs text-muted-foreground">{route.livery}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <Badge variant="secondary" className="capitalize">
                          {route.route_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-2">{formatFlightTime(route.est_flight_time_minutes)}</td>
                      <td className="py-3 px-2">
                        <Badge variant="outline" className="capitalize">
                          {rankLabels[route.min_rank] || route.min_rank}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground max-w-[200px] truncate">
                        {route.notes || "-"}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {canFlyRoute(route.min_rank) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleFilePirep(route)}
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            File PIREP
                          </Button>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline" disabled>
                                  <Lock className="h-3 w-3 mr-1" />
                                  Locked
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Requires {rankLabels[route.min_rank || ""] || route.min_rank} rank</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Route className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No routes found</p>
              <p className="text-sm">Try adjusting your filters or check back later</p>
            </div>
          )}

          {filteredRoutes && filteredRoutes.length > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4">
              <Button variant="outline" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <p className="text-sm text-muted-foreground">Showing {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filteredRoutes.length)} of {filteredRoutes.length}</p>
              <Button variant="outline" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
