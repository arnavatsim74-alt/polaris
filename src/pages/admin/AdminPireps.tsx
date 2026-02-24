import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Shield, Search, Check, X, Pause, FileText, Plus, Trash2, Briefcase } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { sendNotification } from "@/lib/notifications";

type ValidationStatus = "idle" | "validating" | "validated" | "not_validated" | "error";

type ValidationMetadata = {
  source?: string;
  matchedLogId?: string;
  confidence?: number;
  message?: string;
};

export default function AdminPireps() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPirep, setSelectedPirep] = useState<any>(null);
  const [actionType, setActionType] = useState<"approve" | "deny" | "hold" | null>(null);
  const [reason, setReason] = useState("");
  const [newOperator, setNewOperator] = useState("");
  const [deletingOperator, setDeletingOperator] = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>("idle");
  const [validationMetadata, setValidationMetadata] = useState<ValidationMetadata | null>(null);

  const clearActionDialogState = () => {
    setSelectedPirep(null);
    setActionType(null);
    setReason("");
    setValidationStatus("idle");
    setValidationMetadata(null);
  };

  const defaultOperators = [
    "Aeroflot", "Azerbaijan Airlines", "Uzbekistan Airways", "Belavia",
    "S7 Airlines", "AirBridge Cargo", "Saudia", "Emirates", "Fly Dubai",
    "Emirates SkyCargo", "Aegean Airlines", "Qatar Airways",
    "SunCountry Airlines", "IndiGo", "Oman Air", "Others",
  ];

  const { data: operators, refetch: refetchOperators } = useQuery({
    queryKey: ["admin-operators"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("*").eq("key", "pirep_operators").maybeSingle();
      if (data?.value) {
        try { return JSON.parse(data.value) as string[]; } catch { return defaultOperators; }
      }
      return defaultOperators;
    },
  });

  const saveOperators = async (ops: string[]) => {
    const val = JSON.stringify(ops);
    const { data: existing } = await supabase.from("site_settings").select("id").eq("key", "pirep_operators").maybeSingle();
    if (existing) {
      await supabase.from("site_settings").update({ value: val, updated_at: new Date().toISOString() }).eq("key", "pirep_operators");
    } else {
      await supabase.from("site_settings").insert({ key: "pirep_operators", value: val });
    }
    queryClient.invalidateQueries({ queryKey: ["admin-operators"] });
    queryClient.invalidateQueries({ queryKey: ["pirep-operators"] });
  };

  const handleAddOperator = async () => {
    if (!newOperator.trim()) return;
    const current = operators || defaultOperators;
    if (current.includes(newOperator.trim())) { toast.error("Operator already exists"); return; }
    await saveOperators([...current, newOperator.trim()]);
    setNewOperator("");
    toast.success("Operator added");
  };

  const handleRemoveOperator = async (op: string) => {
    const current = operators || defaultOperators;
    await saveOperators(current.filter(o => o !== op));
    setDeletingOperator(null);
    toast.success("Operator removed");
  };

  const { data: pireps, isLoading } = useQuery({
    queryKey: ["admin-pireps", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("pireps")
        .select(`
          *,
          pilots (pid, full_name)
        `)
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as "pending" | "approved" | "denied" | "on_hold");
      }

      const { data } = await query;
      return data || [];
    },
  });

  const { data: multiplierConfigs } = useQuery({
    queryKey: ["multiplier-configs-admin"],
    queryFn: async () => {
      const { data } = await supabase.from("multiplier_configs").select("*").order("value");
      return data || [];
    },
  });

  const getMultiplierName = (value: number) => {
    const config = multiplierConfigs?.find(m => Number(m.value) === Number(value));
    return config ? config.name : `×${value}`;
  };

  const updatePirepMutation = useMutation({
    mutationFn: async ({
      pirepId,
      status,
      reason,
    }: {
      pirepId: string;
      status: "pending" | "approved" | "denied" | "on_hold";
      reason?: string;
    }) => {
      const { error } = await supabase
        .from("pireps")
        .update({
          status,
          status_reason: reason || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", pirepId);

      if (error) throw error;

      const pirep = pireps?.find((p: any) => p.id === pirepId);
      if (pirep?.pilot_id && ["approved", "denied", "on_hold"].includes(status)) {
        await sendNotification({
          recipientPilotId: pirep.pilot_id,
          title: `PIREP ${status.replace("_", " ")}`,
          message: `Your PIREP ${pirep.flight_number} ${pirep.dep_icao}-${pirep.arr_icao} was ${status.replace("_", " ")}.`,
          type: "pirep_status",
          relatedEntity: "pirep",
          relatedId: pirepId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pireps"] });
      toast.success("PIREP updated successfully");
      clearActionDialogState();
    },
    onError: (error) => {
      console.error(error);
      toast.error("Failed to update PIREP");
    },
  });

  const validatePirepMutation = useMutation({
    mutationFn: async (pirep: any) => {
      const { data, error } = await supabase.functions.invoke("validate-pirep", {
        body: {
          pirepId: pirep.id,
          pilotId: pirep.pilot_id,
          flightNumber: pirep.flight_number,
          depIcao: pirep.dep_icao,
          arrIcao: pirep.arr_icao,
          aircraftIcao: pirep.aircraft_icao,
          flightDate: pirep.flight_date,
          flightHours: pirep.flight_hours,
        },
      });

      if (error) throw error;
      return data;
    },
  });

  const handleAction = async (pirep: any, action: "approve" | "deny" | "hold") => {
    if (action === "approve") {
      setSelectedPirep(pirep);
      setActionType("approve");
      setValidationStatus("validating");
      setValidationMetadata(null);

      try {
        const data = await validatePirepMutation.mutateAsync(pirep);
        const isValidated = Boolean(data?.validated ?? data?.is_validated ?? data?.isValid);

        setValidationStatus(isValidated ? "validated" : "not_validated");
        setValidationMetadata({
          source: data?.source,
          matchedLogId: data?.matched_log_id ?? data?.flight_log_id,
          confidence: typeof data?.confidence === "number" ? data.confidence : undefined,
          message: data?.message,
        });
      } catch (error) {
        console.error(error);
        setValidationStatus("error");
        setValidationMetadata({
          message: "Validation request failed. Please try again.",
        });
      }
    } else {
      setSelectedPirep(pirep);
      setActionType(action);
    }
  };

  const submitAction = () => {
    if (!selectedPirep || !actionType) return;
    if ((actionType === "deny" || actionType === "hold") && !reason.trim()) {
      toast.error("Please provide a reason");
      return;
    }

    const status = actionType === "deny" ? "denied" : "on_hold";
    updatePirepMutation.mutate({
      pirepId: selectedPirep.id,
      status,
      reason,
    });
  };

  const filteredPireps = pireps?.filter((pirep) => {
    const matchesSearch =
      searchQuery === "" ||
      pirep.flight_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pirep.pilots?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pirep.pilots?.pid?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Manage PIREPs</h1>
          <p className="text-muted-foreground">Review and approve pilot reports</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by pilot name, PID, or flight number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* PIREPs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Flight Reports</CardTitle>
          <CardDescription>{filteredPireps?.length || 0} PIREPs found</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredPireps && filteredPireps.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Pilot</th>
                    <th className="text-left py-3 px-2 font-medium">Date</th>
                    <th className="text-left py-3 px-2 font-medium">Flight</th>
                    <th className="text-left py-3 px-2 font-medium">Route</th>
                    <th className="text-left py-3 px-2 font-medium">Aircraft</th>
                    <th className="text-left py-3 px-2 font-medium">Operator</th>
                    <th className="text-left py-3 px-2 font-medium">Type</th>
                    <th className="text-left py-3 px-2 font-medium">PAX/Cargo</th>
                    <th className="text-left py-3 px-2 font-medium">Hours</th>
                    <th className="text-left py-3 px-2 font-medium">Multiplier</th>
                    <th className="text-left py-3 px-2 font-medium">Status</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPireps.map((pirep) => (
                    <tr key={pirep.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-2">
                        <div>
                          <p className="font-medium">{pirep.pilots?.full_name}</p>
                          <p className="text-xs text-muted-foreground">{pirep.pilots?.pid}</p>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        {format(new Date(pirep.flight_date), "MMM dd, yyyy")}
                      </td>
                      <td className="py-3 px-2 font-medium">{pirep.flight_number}</td>
                      <td className="py-3 px-2 font-mono">
                        {pirep.dep_icao} → {pirep.arr_icao}
                      </td>
                      <td className="py-3 px-2">{pirep.aircraft_icao}</td>
                      <td className="py-3 px-2 text-muted-foreground">{pirep.operator}</td>
                      <td className="py-3 px-2">
                        <Badge variant="secondary" className="capitalize">
                          {pirep.flight_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">
                        {(pirep.pax ?? 0) > 0 ? `${pirep.pax} pax` : "-"}
                        {(pirep.cargo_kg ?? 0) > 0 ? ` / ${pirep.cargo_kg} kg` : ""}
                      </td>
                      <td className="py-3 px-2">
                        {Number(pirep.flight_hours).toFixed(1)}
                      </td>
                      <td className="py-3 px-2">
                        <span className="font-mono text-xs" title={`×${pirep.multiplier}`}>{getMultiplierName(pirep.multiplier)}</span>
                      </td>
                      <td className="py-3 px-2"><StatusBadge status={pirep.status} classMap={{ on_hold: "status-on-hold" }} /></td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {pirep.status !== "approved" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-success hover:text-success hover:bg-success/10"
                              onClick={() => handleAction(pirep, "approve")}
                              title="Approve"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          {pirep.status !== "denied" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleAction(pirep, "deny")}
                              title="Deny"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                          {pirep.status !== "on_hold" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-warning hover:text-warning hover:bg-warning/10"
                              onClick={() => handleAction(pirep, "hold")}
                              title="Put On Hold"
                            >
                              <Pause className="h-4 w-4" />
                            </Button>
                          )}
                          {pirep.status === "approved" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:bg-muted"
                              onClick={() => handleAction(pirep, "deny")}
                              title="Revoke (Deny)"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        {pirep.status_reason && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate text-right" title={pirep.status_reason}>
                            Note: {pirep.status_reason}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No PIREPs found</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog open={!!actionType} onOpenChange={(open) => !open && clearActionDialogState()}>
        <DialogContent>
          {actionType === "approve" ? (
            <>
              <DialogHeader>
                <DialogTitle>Approve PIREP</DialogTitle>
                <DialogDescription>
                  Validate the flight log before final approval.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-1">
                {validationStatus === "validating" && (
                  <p className="text-sm text-muted-foreground">Validating flight log...</p>
                )}

                {validationStatus === "validated" && (
                  <div className="space-y-2 rounded-md border border-success/30 bg-success/10 p-4 text-success">
                    <div className="flex items-center gap-2 font-medium">
                      <Check className="h-5 w-5 animate-pulse" />
                      PIREP Validated. Would you like to approve?
                    </div>
                  </div>
                )}

                {validationStatus === "not_validated" && (
                  <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-4 text-warning">
                    <p className="font-medium">PIREP is not validated. Would you like to approve anyway?</p>
                  </div>
                )}

                {validationStatus === "error" && (
                  <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                    <p className="font-medium">Validation failed.</p>
                    <p className="text-sm">{validationMetadata?.message}</p>
                  </div>
                )}

                {validationMetadata && (validationMetadata.source || validationMetadata.matchedLogId || validationMetadata.confidence !== undefined) && (
                  <div className="space-y-1 rounded-md border p-3 text-sm">
                    {validationMetadata.source && <p><span className="font-medium">Source:</span> {validationMetadata.source}</p>}
                    {validationMetadata.matchedLogId && <p><span className="font-medium">Matched log:</span> {validationMetadata.matchedLogId}</p>}
                    {validationMetadata.confidence !== undefined && <p><span className="font-medium">Confidence:</span> {Math.round(validationMetadata.confidence * 100)}%</p>}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={clearActionDialogState}>
                  Cancel
                </Button>
                <Button
                  onClick={() => selectedPirep && updatePirepMutation.mutate({ pirepId: selectedPirep.id, status: "approved" })}
                  disabled={validationStatus === "validating" || validationStatus === "idle" || validationStatus === "error" || updatePirepMutation.isPending}
                >
                  Approve
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {actionType === "deny" ? "Deny PIREP" : "Put PIREP On Hold"}
                </DialogTitle>
                <DialogDescription>
                  Please provide a reason for this action.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Textarea
                  placeholder="Enter reason..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={clearActionDialogState}>
                  Cancel
                </Button>
                <Button
                  variant={actionType === "deny" ? "destructive" : "default"}
                  onClick={submitAction}
                  disabled={updatePirepMutation.isPending}
                >
                  {actionType === "deny" ? "Deny" : "Put On Hold"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Operator Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Manage Operators
          </CardTitle>
          <CardDescription>Add or remove operators available in the PIREP filing form</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="New operator name..."
              value={newOperator}
              onChange={(e) => setNewOperator(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddOperator()}
              className="max-w-sm"
            />
            <Button onClick={handleAddOperator} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          <Separator />
          <div className="flex flex-wrap gap-2">
            {(operators || defaultOperators).map((op) => (
              <Badge key={op} variant="secondary" className="flex items-center gap-1 px-3 py-1.5">
                {op}
                <button
                  onClick={() => setDeletingOperator(op)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Confirm Remove Operator */}
      <AlertDialog open={!!deletingOperator} onOpenChange={() => setDeletingOperator(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Operator</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{deletingOperator}"? Existing PIREPs with this operator won't be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingOperator && handleRemoveOperator(deletingOperator)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
