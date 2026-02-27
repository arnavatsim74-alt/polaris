import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Users, Search, Edit, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";


export default function AdminMembers() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [editingPilot, setEditingPilot] = useState<any>(null);
  const [deletingPilot, setDeletingPilot] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    full_name: "",
    pid: "",
    total_hours: 0,
    total_hours_mins: 0,
    current_rank: "cadet",
    manually_ranked: false,
  });
  const [isAdmin_role, setIsAdminRole] = useState(false);

  const { data: pilots, isLoading } = useQuery({
    queryKey: ["admin-pilots"],
    queryFn: async () => {
      const { data } = await supabase.from("pilots").select("*").order("pid");
      return data || [];
    },
  });

  const { data: rankOptions } = useQuery({
    queryKey: ["rank-configs-for-members"],
    queryFn: async () => {
      const { data } = await supabase.from("rank_configs").select("name, label").eq("is_active", true).order("order_index");
      return (data || []).map(r => ({ value: r.name, label: r.label }));
    },
  });

  const { data: adminRoles } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("*").eq("role", "admin");
      return data || [];
    },
  });

  const updatePilotMutation = useMutation({
    mutationFn: async (pilotData: any) => {
      const totalHours = pilotData.total_hours + pilotData.total_hours_mins / 60;
      const updatePayload: any = {
        full_name: pilotData.full_name,
        pid: pilotData.pid,
        total_hours: totalHours,
        current_rank: pilotData.current_rank,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("pilots")
        .update(updatePayload)
        .eq("id", pilotData.id);
      if (error) throw error;

      const hasAdminRole = adminRoles?.some((r: any) => r.user_id === pilotData.user_id);
      if (pilotData.isAdmin && !hasAdminRole) {
        const { error: roleError } = await supabase.from("user_roles").insert({
          user_id: pilotData.user_id,
          role: "admin" as const,
        });
        if (roleError) throw roleError;
      } else if (!pilotData.isAdmin && hasAdminRole) {
        const { error: roleError } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", pilotData.user_id)
          .eq("role", "admin");
        if (roleError) throw roleError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pilots"] });
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      toast.success("Member updated");
      setEditingPilot(null);
    },
    onError: () => toast.error("Failed to update member"),
  });

  const deletePilotMutation = useMutation({
    mutationFn: async (pilot: any) => {
      // Delete related records first
      await supabase.from("pireps").delete().eq("pilot_id", pilot.id);
      await supabase.from("academy_enrollments").delete().eq("pilot_id", pilot.id);
      await supabase.from("academy_lesson_progress").delete().eq("pilot_id", pilot.id);
      await supabase.from("academy_exam_attempts").delete().eq("pilot_id", pilot.id);
      await supabase.from("academy_practicals").delete().eq("pilot_id", pilot.id);
      await supabase.from("event_registrations").delete().eq("pilot_id", pilot.id);
      await supabase.from("challenge_completions").delete().eq("pilot_id", pilot.id);
      await supabase.from("pilot_streaks").delete().eq("pilot_id", pilot.id);
      await supabase.from("user_roles").delete().eq("user_id", pilot.user_id);
      
      const { error } = await supabase.from("pilots").delete().eq("id", pilot.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pilots"] });
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      toast.success("Member removed");
      setDeletingPilot(null);
    },
    onError: (error: any) => {
      console.error(error);
      toast.error(error?.message || "Failed to remove member");
    },
  });

  const openEdit = (pilot: any) => {
    const hours = Math.floor(Number(pilot.total_hours) || 0);
    const mins = Math.round(((Number(pilot.total_hours) || 0) - hours) * 60);
    const hasAdmin = adminRoles?.some((r: any) => r.user_id === pilot.user_id);
    setEditForm({
      full_name: pilot.full_name,
      pid: pilot.pid,
      total_hours: hours,
      total_hours_mins: mins,
      current_rank: pilot.current_rank || "cadet",
      manually_ranked: false,
    });
    setIsAdminRole(!!hasAdmin);
    setEditingPilot(pilot);
  };

  const handleSave = () => {
    if (!editingPilot) return;
    updatePilotMutation.mutate({
      id: editingPilot.id,
      user_id: editingPilot.user_id,
      ...editForm,
      isAdmin: isAdmin_role,
    });
  };

  const filtered = pilots?.filter(
    (p) =>
      searchQuery === "" ||
      p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.pid.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Manage Members</h1>
          <p className="text-muted-foreground">Edit callsigns, ranks, hours, and permissions</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or callsign..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>{filtered?.length || 0} members</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered && filtered.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Name</th>
                    <th className="text-left py-3 px-2 font-medium">Callsign</th>
                    <th className="text-left py-3 px-2 font-medium">Rank</th>
                    <th className="text-left py-3 px-2 font-medium">Hours</th>
                    <th className="text-left py-3 px-2 font-medium">PIREPs</th>
                    <th className="text-left py-3 px-2 font-medium">Role</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((pilot) => {
                    const hasAdmin = adminRoles?.some((r: any) => r.user_id === pilot.user_id);
                    return (
                      <tr key={pilot.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-3 px-2 font-medium">{pilot.full_name}</td>
                        <td className="py-3 px-2 font-mono text-xs">{pilot.pid}</td>
                        <td className="py-3 px-2 capitalize">
                          <Badge variant="outline">{(pilot.current_rank || "cadet").replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="py-3 px-2">{Number(pilot.total_hours || 0).toFixed(1)}h</td>
                        <td className="py-3 px-2">{pilot.total_pireps || 0}</td>
                        <td className="py-3 px-2">
                          {hasAdmin ? (
                            <Badge className="bg-primary/20 text-primary">Admin</Badge>
                          ) : (
                            <Badge variant="secondary">Pilot</Badge>
                          )}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(pilot)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeletingPilot(pilot)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No members found</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Member Dialog */}
      <Dialog open={!!editingPilot} onOpenChange={(open) => !open && setEditingPilot(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Callsign</Label>
                <Input
                  value={editForm.pid}
                  onChange={(e) => setEditForm({ ...editForm, pid: e.target.value })}
                />
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Flight Time</h4>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label>Hours</Label>
                  <Input
                    type="number"
                    value={editForm.total_hours}
                    onChange={(e) => setEditForm({ ...editForm, total_hours: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Mins</Label>
                  <Input
                    type="number"
                    value={editForm.total_hours_mins}
                    onChange={(e) => setEditForm({ ...editForm, total_hours_mins: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Pilot Rank (To edit member must be manually ranked)</Label>
                <Select
                  value={editForm.current_rank}
                  onValueChange={(v) => setEditForm({ ...editForm, current_rank: v })}
                  disabled={!editForm.manually_ranked}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(rankOptions || []).map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={isAdmin_role ? "Admin" : "Pilot"} readOnly />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={editForm.manually_ranked}
                onCheckedChange={(v) => setEditForm({ ...editForm, manually_ranked: !!v })}
              />
              <Label>Manually Ranked</Label>
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Member Permissions</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={isAdmin_role}
                  onCheckedChange={(v) => setIsAdminRole(!!v)}
                />
                <Label>Admin Access</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPilot(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updatePilotMutation.isPending}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete / Kick Member Dialog */}
      <Dialog open={!!deletingPilot} onOpenChange={(open) => !open && setDeletingPilot(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Remove Member
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{deletingPilot?.full_name}</strong> ({deletingPilot?.pid})? This will delete all their PIREPs, enrollments, exam attempts, and other data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingPilot(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deletePilotMutation.mutate(deletingPilot)} disabled={deletePilotMutation.isPending}>
              Remove Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
