import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Shield, Activity, CalendarOff, Check, X, Settings, Calendar, Clock, Infinity } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
type StatMode = "lifetime" | "last_month" | "custom";

interface DateRange {
  from: string; // ISO date string yyyy-mm-dd
  to: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getLastMonthRange(): DateRange {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDay  = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    from: firstDay.toISOString().slice(0, 10),
    to:   lastDay.toISOString().slice(0, 10),
  };
}

function formatFlightTime(totalHours: number) {
  const h = Math.floor(totalHours);
  const m = Math.round((totalHours - h) * 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function lastMonthLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

// ─── Sliding Stat Modes ───────────────────────────────────────────────────────
const MODES: { key: StatMode; label: string; icon: React.ReactNode }[] = [
  { key: "lifetime",   label: "Lifetime",   icon: <Infinity className="h-3.5 w-3.5" /> },
  { key: "last_month", label: "Last month", icon: <Calendar className="h-3.5 w-3.5" /> },
  { key: "custom",     label: "Custom",     icon: <Clock className="h-3.5 w-3.5" />    },
];

// ─── Animated stat value ──────────────────────────────────────────────────────
function AnimatedStat({ value, loading }: { value: string; loading: boolean }) {
  if (loading) return <Skeleton className="h-8 w-24 mt-1" />;
  return (
    <p
      key={value}
      className="text-2xl font-bold mt-1 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
    >
      {value}
    </p>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminActivity() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Activity Management</h1>
          <p className="text-muted-foreground">Overview stats, LOA management, and activity policy</p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview"><Activity className="h-4 w-4 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="loa"><CalendarOff className="h-4 w-4 mr-1" />LOA Requests</TabsTrigger>
          <TabsTrigger value="policy"><Settings className="h-4 w-4 mr-1" />Policy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="loa"><LoaTab /></TabsContent>
        <TabsContent value="policy"><PolicyTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const [mode, setMode] = useState<StatMode>("lifetime");
  const [customRange, setCustomRange] = useState<DateRange>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { from: today, to: today };
  });

  // Slider indicator position
  const modeIndex = MODES.findIndex((m) => m.key === mode);

  // Effective date range for filtering
  const dateRange: DateRange | null =
    mode === "last_month" ? getLastMonthRange() :
    mode === "custom"     ? customRange :
    null;

  const queryKey = ["admin-activity-stats", mode, dateRange?.from, dateRange?.to];

  const { data: stats, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // Members count is always total (not time-filtered)
      const { data: pilots } = await supabase
        .from("pilots")
        .select("id");

      let pireqQuery = supabase
        .from("pireps")
        .select("flight_hours, multiplier, status, created_at");

      if (dateRange) {
        pireqQuery = pireqQuery
          .gte("created_at", `${dateRange.from}T00:00:00Z`)
          .lte("created_at", `${dateRange.to}T23:59:59Z`);
      }

      const { data: pireps } = await pireqQuery;

      const totalMembers    = pilots?.length ?? 0;
      const totalPireps     = pireps?.length ?? 0;
      const approvedPireps  = pireps?.filter((p) => p.status === "approved").length ?? 0;
      const totalHoursApproved = pireps
        ?.filter((p) => p.status === "approved")
        .reduce((sum, p) => sum + Number(p.flight_hours) * Number(p.multiplier || 1), 0) ?? 0;

      return { totalMembers, totalPireps, approvedPireps, totalHoursApproved };
    },
    enabled: mode !== "custom" || (!!customRange.from && !!customRange.to && customRange.from <= customRange.to),
  });

  const rangeLabel =
    mode === "lifetime"   ? "All time" :
    mode === "last_month" ? lastMonthLabel() :
    customRange.from && customRange.to
      ? `${new Date(customRange.from).toLocaleDateString()} – ${new Date(customRange.to).toLocaleDateString()}`
      : "Select dates";

  return (
    <div className="space-y-5">
      {/* Mode Switcher */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="space-y-4">
            {/* Slider pill */}
            <div className="relative bg-muted rounded-lg p-1 flex">
              {/* Sliding background */}
              <div
                className="absolute top-1 bottom-1 rounded-md bg-background border border-border transition-all duration-300 ease-in-out"
                style={{
                  width:  `calc(${100 / MODES.length}% - 4px)`,
                  left:   `calc(${(modeIndex / MODES.length) * 100}% + 4px)`,
                }}
              />
              {MODES.map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={cn(
                    "relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-sm font-medium rounded-md transition-colors duration-200",
                    mode === key
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {/* Custom date pickers — animate in/out */}
            <div
              className={cn(
                "grid grid-cols-2 gap-3 overflow-hidden transition-all duration-300",
                mode === "custom" ? "max-h-24 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
              )}
            >
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={customRange.from}
                  max={customRange.to}
                  onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={customRange.to}
                  min={customRange.from}
                  onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                />
              </div>
            </div>

            {/* Range label */}
            <p className="text-xs text-muted-foreground">
              Showing stats for: <span className="font-medium text-foreground">{rangeLabel}</span>
              {mode !== "lifetime" && <span className="ml-1 text-muted-foreground">(members count is always total)</span>}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Members</p>
            <AnimatedStat
              loading={isLoading}
              value={String(stats?.totalMembers ?? 0)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Flight Time (Approved)</p>
            <AnimatedStat
              loading={isLoading}
              value={formatFlightTime(stats?.totalHoursApproved ?? 0)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">PIREPs Filed</p>
            <AnimatedStat
              loading={isLoading}
              value={String(stats?.totalPireps ?? 0)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">PIREPs Approved</p>
            <AnimatedStat
              loading={isLoading}
              value={String(stats?.approvedPireps ?? 0)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── LOA Tab ──────────────────────────────────────────────────────────────────
function LoaTab() {
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: string } | null>(null);

  const { data: loaRequests, isLoading } = useQuery({
    queryKey: ["admin-loa-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loa_requests")
        .select("*, pilots!loa_requests_pilot_id_fkey(pid, full_name)")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("loa_requests")
        .update({ status, reviewed_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-loa-requests"] });
      toast.success("LOA request updated");
      setConfirmAction(null);
    },
    onError: () => toast.error("Failed to update LOA"),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>LOA Requests</CardTitle>
          <CardDescription>{loaRequests?.length || 0} requests</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : loaRequests && loaRequests.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Pilot</th>
                    <th className="text-left py-3 px-2 font-medium">Period</th>
                    <th className="text-left py-3 px-2 font-medium">Reason</th>
                    <th className="text-left py-3 px-2 font-medium">Status</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loaRequests.map((loa: any) => (
                    <tr key={loa.id} className="border-b last:border-0">
                      <td className="py-3 px-2">
                        {loa.pilots?.full_name} ({loa.pilots?.pid})
                      </td>
                      <td className="py-3 px-2 text-xs">
                        {new Date(loa.start_date).toLocaleDateString()} — {new Date(loa.end_date).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-2 text-muted-foreground max-w-[200px] truncate">
                        {loa.reason || "—"}
                      </td>
                      <td className="py-3 px-2">
                        <Badge
                          variant={
                            loa.status === "approved" ? "default" :
                            loa.status === "denied"   ? "destructive" :
                            "secondary"
                          }
                        >
                          {loa.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-right">
                        {loa.status === "pending" && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmAction({ id: loa.id, action: "approved" })}
                            >
                              <Check className="h-3 w-3 mr-1" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setConfirmAction({ id: loa.id, action: "denied" })}
                            >
                              <X className="h-3 w-3 mr-1" /> Deny
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground">No LOA requests</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm {confirmAction?.action === "approved" ? "Approval" : "Denial"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {confirmAction?.action === "approved" ? "approve" : "deny"} this LOA request?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmAction &&
                updateMutation.mutate({ id: confirmAction.id, status: confirmAction.action })
              }
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Policy Tab ───────────────────────────────────────────────────────────────
function PolicyTab() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState("");

  const { data: currentReq } = useQuery({
    queryKey: ["activity-requirement-admin"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("*")
        .eq("key", "activity_pirep_days")
        .maybeSingle();
      if (data?.value) setDays(data.value);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (currentReq) {
        const { error } = await supabase
          .from("site_settings")
          .update({ value: days || null, updated_at: new Date().toISOString() })
          .eq("key", "activity_pirep_days");
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("site_settings")
          .insert({ key: "activity_pirep_days", value: days || null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity-requirement-admin"] });
      queryClient.invalidateQueries({ queryKey: ["activity-requirement"] });
      toast.success("Activity policy saved");
    },
    onError: () => toast.error("Failed to save policy"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Requirement</CardTitle>
        <CardDescription>Set the minimum activity requirement for all pilots</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Every 1 PIREP must be filed every X days</Label>
          <div className="flex gap-2 items-center max-w-sm">
            <Input
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="e.g. 30"
              min={1}
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">days</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave empty to disable the activity requirement. Pilots on approved LOA are exempt.
          </p>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Save Policy
        </Button>
      </CardContent>
    </Card>
  );
}
