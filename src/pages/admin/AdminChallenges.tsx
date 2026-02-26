import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, Plus, Trash2, Edit, Target } from "lucide-react";
import { toast } from "sonner";

type ChallengeForm = { name: string; description: string; image_url: string };

const removeRouteLegBlock = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(/\n?@?--\s*ROUTE_LEGS_START\s*--@?\n?/gi, "\n")
    .replace(/\n?@?--\s*ROUTE_LEGS_END\s*--@?\n?/gi, "\n")
    .replace(/\n?<!--\s*ROUTE_LEGS_START\s*-->\n?/gi, "\n")
    .replace(/\n?<!--\s*ROUTE_LEGS_END\s*-->\n?/gi, "\n")
    .replace(/\n?### Route Legs\n(?:\d+\. .*\n?)*$/m, "")
    .trim();
};

const buildRouteLegBlock = (routes: any[]) => {
  if (!routes.length) return "";

  const lines = routes.map((route: any, index: number) => {
    const totalMinutes = Number(route.est_flight_time_minutes || 0);
    const duration = `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
    return `${index + 1}. ${route.route_number || "N/A"} | ${route.dep_icao || "N/A"}-${route.arr_icao || "N/A"} | ${route.aircraft_icao || "N/A"} | ${duration}`;
  });

  return `### Route Legs
${lines.join("\n")}`;
};

const mergeDescriptionWithRouteLegs = (description: string, routes: any[]) => {
  const baseDescription = removeRouteLegBlock(description || "");
  const routeLegBlock = buildRouteLegBlock(routes);
  if (!routeLegBlock) return baseDescription;
  return baseDescription ? `${baseDescription}

${routeLegBlock}` : routeLegBlock;
};

export default function AdminChallenges() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [routeSearch, setRouteSearch] = useState("");
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [form, setForm] = useState<ChallengeForm>({ name: "", description: "", image_url: "" });

  const { data: challenges, isLoading } = useQuery({
    queryKey: ["admin-challenges"],
    queryFn: async () => {
      const { data } = await supabase
        .from("challenges")
        .select("*, challenge_legs(id, route_id, leg_order, route:routes(id, route_number, dep_icao, arr_icao, aircraft_icao, est_flight_time_minutes))")
        .order("created_at");
      return data || [];
    },
  });

  const { data: routes } = useQuery({
    queryKey: ["admin-challenge-routes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("routes")
        .select("id, route_number, dep_icao, arr_icao, aircraft_icao, est_flight_time_minutes")
        .eq("is_active", true)
        .order("route_number");
      return data || [];
    },
  });

  const { data: acceptances } = useQuery({
    queryKey: ["admin-challenge-acceptances"],
    queryFn: async () => {
      const { data } = await supabase
        .from("challenge_completions")
        .select("id, status, completed_at, challenge_id, pilot_id, challenges!challenge_completions_challenge_id_fkey(name), pilots!challenge_completions_pilot_id_fkey(full_name, pid)")
        .order("completed_at", { ascending: false, nullsFirst: false });
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: ChallengeForm & { id?: string; routeIds: string[] }) => {
      const payload = {
        name: data.name,
        description: data.description || null,
        image_url: data.image_url || null,
      };

      let challengeId = data.id;
      if (challengeId) {
        const { error } = await supabase.from("challenges").update(payload).eq("id", challengeId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from("challenges").insert(payload).select("id").single();
        if (error) throw error;
        challengeId = inserted.id;

        await supabase.functions.invoke("discord-rank-notification", {
          body: {
            type: "new_challenge",
            name: data.name,
            description: data.description || null,
            image_url: data.image_url || null,
          },
        });
      }

      const { error: clearError } = await supabase.from("challenge_legs").delete().eq("challenge_id", challengeId);
      if (clearError) throw clearError;

      if (data.routeIds.length > 0) {
        const legs = data.routeIds.map((routeId, index) => ({
          challenge_id: challengeId,
          route_id: routeId,
          leg_order: index + 1,
          leg_code: `${data.name || "LEG"}${index + 1}`,
        }));
        const { error: legsError } = await supabase.from("challenge_legs").insert(legs);
        if (legsError) throw legsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-challenges"] });
      toast.success(editingId ? "Challenge updated" : "Challenge created");
      closeDialog();
    },
    onError: () => toast.error("Failed to save challenge"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("challenges").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-challenges"] });
      toast.success("Challenge deleted");
    },
    onError: () => toast.error("Failed to delete challenge"),
  });

  const updateAcceptanceStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "incomplete" | "complete" }) => {
      const { error } = await supabase
        .from("challenge_completions")
        .update({ status, completed_at: status === "complete" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-challenge-acceptances"] });
      queryClient.invalidateQueries({ queryKey: ["challenge-completions"] });
      toast.success("Challenge status updated");
    },
    onError: () => toast.error("Failed to update status"),
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingId(null);
    setSelectedRouteIds([]);
    setRouteSearch("");
    setForm({ name: "", description: "", image_url: "" });
  };

  const openEdit = (ch: any) => {
    setEditingId(ch.id);
    setForm({ name: ch.name, description: ch.description || "", image_url: ch.image_url || "" });
    const orderedLegs = [...(ch.challenge_legs || [])].sort((a: any, b: any) => a.leg_order - b.leg_order);
    setSelectedRouteIds(orderedLegs.map((l: any) => l.route_id));
    setIsDialogOpen(true);
  };

  const filteredRoutes = useMemo(() => {
    const q = routeSearch.trim().toLowerCase();
    if (!q) return routes || [];
    return (routes || []).filter((r: any) =>
      [r.route_number, r.dep_icao, r.arr_icao, r.aircraft_icao].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [routes, routeSearch]);

  const selectedRoutes = useMemo(() => {
    if (!routes || selectedRouteIds.length === 0) return [];
    const routeMap = new Map((routes || []).map((route: any) => [route.id, route]));
    return selectedRouteIds
      .map((id) => routeMap.get(id))
      .filter(Boolean);
  }, [routes, selectedRouteIds]);

  useEffect(() => {
    if (!isDialogOpen) return;

    setForm((prev) => {
      const nextDescription = mergeDescriptionWithRouteLegs(prev.description, selectedRoutes);
      if (nextDescription === prev.description) return prev;
      return { ...prev, description: nextDescription };
    });
  }, [isDialogOpen, selectedRoutes]);

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Manage Challenges</h1>
            <p className="text-muted-foreground">Create and manage pilot challenges</p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); setSelectedRouteIds([]); setForm({ name: "", description: "", image_url: "" }); setIsDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />Add Challenge
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Challenge" : "Create Challenge"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Embed Title / Challenge Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="World Tour 1" />
              </div>
              <div className="space-y-2">
                <Label>Embed Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Challenge details" />
              </div>
              <div className="space-y-2">
                <Label>Embed Image URL (optional)</Label>
                <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." />
              </div>

              <div className="space-y-2">
                <Label>Add Routes (Legs)</Label>
                <Input value={routeSearch} onChange={(e) => setRouteSearch(e.target.value)} placeholder="Search by route, ICAO, aircraft" />
                <div className="max-h-56 overflow-auto rounded border p-2 space-y-2">
                  {filteredRoutes.map((r: any) => {
                    const checked = selectedRouteIds.includes(r.id);
                    const duration = `${Math.floor((r.est_flight_time_minutes || 0) / 60)}:${String((r.est_flight_time_minutes || 0) % 60).padStart(2, "0")}`;
                    return (
                      <label key={r.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => setSelectedRouteIds((prev) => value ? [...prev, r.id] : prev.filter((id) => id !== r.id))}
                        />
                        <span>| {r.route_number} | {r.dep_icao}-{r.arr_icao} | {r.aircraft_icao || "N/A"} | {duration} |</span>
                      </label>
                    );
                  })}
                  {filteredRoutes.length === 0 && <p className="text-sm text-muted-foreground">No routes found.</p>}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate({ ...form, id: editingId || undefined, routeIds: selectedRouteIds })} disabled={saveMutation.isPending || !form.name.trim()}>
                {editingId ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Challenges</CardTitle>
          <CardDescription>{challenges?.length || 0} challenges</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : challenges && challenges.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Name</th>
                    <th className="text-left py-3 px-2 font-medium">Description</th>
                    <th className="text-left py-3 px-2 font-medium">Legs</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {challenges.map((ch: any) => (
                    <tr key={ch.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-2 font-medium">{ch.name}</td>
                      <td className="py-3 px-2 text-muted-foreground max-w-[300px] truncate">{ch.description || "-"}</td>
                      <td className="py-3 px-2">
                        <Badge variant="secondary">{(ch.challenge_legs || []).length} legs</Badge>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(ch)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <ConfirmDialog trigger={<Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></Button>} title="Delete Challenge?" description="This challenge will be permanently deleted." onConfirm={() => deleteMutation.mutate(ch.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No challenges yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Challenge Acceptances</CardTitle>
          <CardDescription>Pilot accepted challenges and completion status</CardDescription>
        </CardHeader>
        <CardContent>
          {acceptances && acceptances.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Pilot</th>
                    <th className="text-left py-3 px-2 font-medium">Challenge</th>
                    <th className="text-left py-3 px-2 font-medium">Status</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {acceptances.map((a: any) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-3 px-2">{a.pilots?.full_name} ({a.pilots?.pid})</td>
                      <td className="py-3 px-2">{a.challenges?.name || "-"}</td>
                      <td className="py-3 px-2">
                        <Badge variant={a.status === "complete" ? "default" : "secondary"}>{a.status}</Badge>
                      </td>
                      <td className="py-3 px-2 text-right">
                        {a.status === "incomplete" ? (
                          <Button size="sm" onClick={() => updateAcceptanceStatusMutation.mutate({ id: a.id, status: "complete" })}>Mark Complete</Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => updateAcceptanceStatusMutation.mutate({ id: a.id, status: "incomplete" })}>Mark Incomplete</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground">No accepted challenges yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
