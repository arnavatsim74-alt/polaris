import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Plus, Trash2, Star, Sparkles } from "lucide-react";
import { format, startOfWeek, addWeeks } from "date-fns";
import { toast } from "sonner";

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function AdminROTW() {
  const { isAdmin, pilot } = useAuth();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState("");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );

  // Featured route state
  const [isFeaturedDialogOpen, setIsFeaturedDialogOpen] = useState(false);
  const [featuredRouteId, setFeaturedRouteId] = useState("");
  const [rotwRouteSearch, setRotwRouteSearch] = useState("");
  const [featuredRouteSearch, setFeaturedRouteSearch] = useState("");

  const today = format(new Date(), "yyyy-MM-dd");

  const weekOptions = Array.from({ length: 5 }, (_, i) => {
    const weekStart = startOfWeek(addWeeks(new Date(), i), { weekStartsOn: 1 });
    return {
      value: format(weekStart, "yyyy-MM-dd"),
      label: `Week of ${format(weekStart, "MMM dd, yyyy")}`,
    };
  });

  const { data: routes } = useQuery({
    queryKey: ["all-routes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("routes")
        .select("*")
        .eq("is_active", true)
        .order("route_number");
      return data || [];
    },
  });

  const { data: rotwRoutes, isLoading } = useQuery({
    queryKey: ["admin-rotw", selectedWeek],
    queryFn: async () => {
      const { data } = await supabase
        .from("routes_of_week")
        .select(`
          id, week_start, day_of_week,
          route:routes (id, route_number, dep_icao, arr_icao, aircraft_icao, route_type, est_flight_time_minutes, min_rank)
        `)
        .eq("week_start", selectedWeek)
        .order("day_of_week");
      return data || [];
    },
  });

  // Featured routes for today
  const { data: featuredRoutes } = useQuery({
    queryKey: ["admin-featured-routes", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_featured_routes")
        .select(`
          id, featured_date,
          route:routes (id, route_number, dep_icao, arr_icao, aircraft_icao)
        `)
        .eq("featured_date", today);
      return data || [];
    },
  });

  const addROTWMutation = useMutation({
    mutationFn: async ({ routeId, dayOfWeek }: { routeId: string; dayOfWeek: number }) => {
      const { error } = await supabase.from("routes_of_week").insert({
        route_id: routeId,
        week_start: selectedWeek,
        day_of_week: dayOfWeek,
        created_by: pilot?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-rotw"] });
      toast.success("Route assigned to day");
      setIsAddDialogOpen(false);
      setSelectedRoute("");
      setSelectedDay(null);
    },
    onError: () => toast.error("Failed to assign route"),
  });

  const removeROTWMutation = useMutation({
    mutationFn: async (rotwId: string) => {
      const { error } = await supabase.from("routes_of_week").delete().eq("id", rotwId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-rotw"] });
      toast.success("Route removed");
    },
    onError: () => toast.error("Failed to remove route"),
  });

  const addFeaturedMutation = useMutation({
    mutationFn: async (routeId: string) => {
      const { error } = await supabase.from("daily_featured_routes").insert({
        route_id: routeId,
        featured_date: today,
      });
      if (error) throw error;

      // Send Discord webhook
      const route = routes?.find((r) => r.id === routeId);
      if (route) {
        try {
          await supabase.functions.invoke("discord-rank-notification", {
            body: {
              type: "featured_route",
              route_number: route.route_number,
              dep_icao: route.dep_icao,
              arr_icao: route.arr_icao,
              aircraft_icao: route.aircraft_icao,
              featured_date: today,
            },
          });
        } catch (e) {
          console.error("Discord notification failed:", e);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-featured-routes"] });
      queryClient.invalidateQueries({ queryKey: ["daily-featured"] });
      toast.success("Featured route added & sent to Discord");
      setIsFeaturedDialogOpen(false);
      setFeaturedRouteId("");
    },
    onError: () => toast.error("Failed to add featured route"),
  });

  const removeFeaturedMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_featured_routes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-featured-routes"] });
      queryClient.invalidateQueries({ queryKey: ["daily-featured"] });
      toast.success("Featured route removed");
    },
    onError: () => toast.error("Failed to remove featured route"),
  });

  const getRouteForDay = (dayIndex: number) => {
    return rotwRoutes?.find((r: any) => r.day_of_week === dayIndex);
  };

  const routeMatchesSearch = (route: any, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const text = `${route.route_number} ${route.dep_icao} ${route.arr_icao} ${route.aircraft_icao} ${route.livery || ""}`.toLowerCase();
    return text.includes(q);
  };

  const filteredRotwRoutes = (routes || []).filter((route: any) => routeMatchesSearch(route, rotwRouteSearch));
  const filteredFeaturedRoutes = (routes || []).filter((route: any) => routeMatchesSearch(route, featuredRouteSearch));

  const openAddDialog = (dayIndex: number) => {
    setSelectedDay(dayIndex);
    setSelectedRoute("");
    setIsAddDialogOpen(true);
  };

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Manage Daily Routes</h1>
            <p className="text-muted-foreground">Assign ROTW and featured routes</p>
          </div>
        </div>
        <Select value={selectedWeek} onValueChange={setSelectedWeek}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weekOptions.map((week) => (
              <SelectItem key={week.value} value={week.value}>
                {week.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Featured Routes of the Day */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Featured Routes — {format(new Date(), "MMM dd, yyyy")}
              </CardTitle>
              <CardDescription>
                Featured routes appear on the dashboard with a 2x multiplier badge and are sent to Discord.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => { setFeaturedRouteId(""); setIsFeaturedDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Featured
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {featuredRoutes && featuredRoutes.length > 0 ? (
            <div className="space-y-2">
              {featuredRoutes.map((fr: any) => (
                <div key={fr.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50">
                  <div className="flex items-center gap-3 text-sm">
                    <Badge variant="secondary" className="font-mono">{fr.route?.route_number}</Badge>
                    <span>{fr.route?.dep_icao} → {fr.route?.arr_icao}</span>
                    <span className="text-muted-foreground">({fr.route?.aircraft_icao})</span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => removeFeaturedMutation.mutate(fr.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No featured routes set for today.</p>
          )}
        </CardContent>
      </Card>

      {/* Weekly ROTW Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Route Schedule</CardTitle>
          <CardDescription>
            {rotwRoutes?.length || 0} of 7 days assigned for {format(new Date(selectedWeek), "MMM dd, yyyy")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {dayNames.map((dayName, dayIndex) => {
                const rotw: any = getRouteForDay(dayIndex);
                return (
                  <div key={dayIndex} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50">
                    <div className="flex items-center gap-4">
                      <div className="w-24">
                        <p className="font-medium text-sm">{dayName}</p>
                      </div>
                      {rotw?.route ? (
                        <div className="flex items-center gap-3 text-sm">
                          <Badge variant="secondary" className="font-mono">{rotw.route.route_number}</Badge>
                          <span>{rotw.route.dep_icao} → {rotw.route.arr_icao}</span>
                          <span className="text-muted-foreground">({rotw.route.aircraft_icao})</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">No route assigned</span>
                      )}
                    </div>
                    <div>
                      {rotw ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeROTWMutation.mutate(rotw.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openAddDialog(dayIndex)}>
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Assign
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ROTW Assign Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Route — {selectedDay !== null ? dayNames[selectedDay] : ""}</DialogTitle>
            <DialogDescription>Select a route to feature on this day</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={rotwRouteSearch}
              onChange={(e) => setRotwRouteSearch(e.target.value)}
              placeholder="Search route number, ICAO, aircraft..."
            />
            <Select value={selectedRoute} onValueChange={setSelectedRoute}>
              <SelectTrigger>
                <SelectValue placeholder="Select a route" />
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                {filteredRotwRoutes.map((route: any) => (
                  <SelectItem key={route.id} value={route.id}>
                    {route.route_number} — {route.dep_icao} → {route.arr_icao} ({route.aircraft_icao})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedDay !== null && addROTWMutation.mutate({ routeId: selectedRoute, dayOfWeek: selectedDay })}
              disabled={!selectedRoute || addROTWMutation.isPending}
            >
              <Star className="h-4 w-4 mr-2" />
              Assign Route
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Featured Route Dialog */}
      <Dialog open={isFeaturedDialogOpen} onOpenChange={setIsFeaturedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Featured Route</DialogTitle>
            <DialogDescription>This route will appear on the dashboard and be sent to Discord.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={featuredRouteSearch}
              onChange={(e) => setFeaturedRouteSearch(e.target.value)}
              placeholder="Search route number, ICAO, aircraft..."
            />
            <Select value={featuredRouteId} onValueChange={setFeaturedRouteId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a route" />
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                {filteredFeaturedRoutes.map((route: any) => (
                  <SelectItem key={route.id} value={route.id}>
                    {route.route_number} — {route.dep_icao} → {route.arr_icao} ({route.aircraft_icao})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFeaturedDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addFeaturedMutation.mutate(featuredRouteId)}
              disabled={!featuredRouteId || addFeaturedMutation.isPending}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Add & Notify Discord
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
