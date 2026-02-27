import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Upload, Plus, Trash2, Route, Download } from "lucide-react";
import { toast } from "sonner";
import { RouteImportMapping } from "@/components/admin/RouteImportMapping";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { getAircraftLiveryPairs, splitRouteAircraft, splitRouteValues } from "@/lib/routeAircraft";

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

export default function AdminRoutes() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [parsedRoutes, setParsedRoutes] = useState<ParsedRoute[]>([]);
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [newRoute, setNewRoute] = useState({
    route_number: "",
    dep_icao: "",
    arr_icao: "",
    aircraft_icao: "",
    route_type: "passenger" as "passenger" | "cargo",
    est_flight_time_minutes: 0,
    min_rank: "cadet",
    notes: "",
  });

  const { data: routes, isLoading } = useQuery({
    queryKey: ["admin-routes"],
    queryFn: async () => {
      const { fetchAllRows } = await import("@/lib/fetchAllRows");
      return fetchAllRows("routes", { orderColumn: "route_number" });
    },
  });

  const { data: aircraft } = useQuery({
    queryKey: ["aircraft"],
    queryFn: async () => {
      const { data } = await supabase.from("aircraft").select("*").order("icao_code");
      return data || [];
    },
  });

  const addRouteMutation = useMutation({
    mutationFn: async (route: typeof newRoute) => {
      const { error } = await supabase.from("routes").insert({
        route_number: route.route_number,
        dep_icao: route.dep_icao,
        arr_icao: route.arr_icao,
        aircraft_icao: route.aircraft_icao || null,
        route_type: route.route_type,
        est_flight_time_minutes: route.est_flight_time_minutes,
        min_rank: route.min_rank as "cadet" | "first_officer" | "captain" | "senior_captain" | "commander",
        notes: route.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-routes"] });
      toast.success("Route added successfully");
      setIsAddDialogOpen(false);
      setNewRoute({
        route_number: "",
        dep_icao: "",
        arr_icao: "",
        aircraft_icao: "",
        route_type: "passenger",
        est_flight_time_minutes: 0,
        min_rank: "cadet",
        notes: "",
      });
    },
    onError: (error) => {
      console.error(error);
      toast.error("Failed to add route");
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      const { error } = await supabase.from("routes").delete().eq("id", routeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-routes"] });
      toast.success("Route deleted");
    },
    onError: (error) => {
      console.error(error);
      toast.error("Failed to delete route");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids || ids.length === 0) {
        throw new Error("No IDs provided");
      }
      const validIds = ids.filter(id => id && id.length > 0);
      if (validIds.length === 0) {
        throw new Error("No valid IDs provided");
      }
      console.log("Bulk deleting IDs:", validIds);
      
      let { error } = await supabase.from("routes").delete().in("id", validIds);
      
      if (error) {
        console.error("Bulk delete error, trying individual deletes:", error);
        let deletedCount = 0;
        for (const id of validIds) {
          const { error: singleError } = await supabase.from("routes").delete().eq("id", id);
          if (!singleError) deletedCount++;
        }
        if (deletedCount === 0) {
          throw new Error("All deletes failed");
        }
        return deletedCount;
      }
      return validIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["admin-routes"] });
      setSelectedRouteIds([]);
      toast.success(`${count} routes deleted`);
    },
    onError: (error: Error) => {
      console.error("Bulk delete failed:", error);
      toast.error(`Failed to delete routes: ${error.message}`);
    },
  });

  // Parse delimited line respecting quoted fields
  const parseCSVLine = (line: string, delimiter: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const detectDelimiter = (headerLine: string) => {
    if (headerLine.includes("\t")) return "\t";
    if (headerLine.includes(";")) return ";";
    return ",";
  };

  // Normalize header name for flexible matching
  const normalizeColumnName = (name: string): string => {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[_\s]+/g, "") // Remove whitespace/underscores
      .trim();
  };

  // Find column index by possible names (exact → startsWith → contains)
  const findColumnIndex = (headers: string[], possibleNames: string[]): number => {
    const normalizedHeaders = headers.map(normalizeColumnName);
    const normalizedNames = possibleNames.map(normalizeColumnName);

    // Priority 1: Exact match
    for (const name of normalizedNames) {
      const idx = normalizedHeaders.indexOf(name);
      if (idx !== -1) return idx;
    }

    // Priority 2: Starts with
    for (const name of normalizedNames) {
      const idx = normalizedHeaders.findIndex((h) => h.startsWith(name));
      if (idx !== -1) return idx;
    }

    // Priority 3: Contains (fallback)
    for (const name of normalizedNames) {
      const idx = normalizedHeaders.findIndex((h) => h.includes(name));
      if (idx !== -1) return idx;
    }

    return -1;
  };


  const normalizeRouteType = (value?: string) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (["cargo", "freighter", "cargo flight", "freight"].includes(normalized)) return "cargo" as const;
    return "passenger" as const;
  };
  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length === 0) {
        toast.error("CSV file is empty");
        return;
      }

      const delimiter = detectDelimiter(lines[0]);
      const headers = parseCSVLine(lines[0], delimiter);

      // Find column indices using flexible matching
      const routeNumberIdx = findColumnIndex(headers, ["routenumber", "route"]);
      const depIcaoIdx = findColumnIndex(headers, ["departureicao", "depicao", "departure", "dep"]);
      const arrIcaoIdx = findColumnIndex(headers, ["arrivalicao", "arricao", "arrival", "arr"]);
      const aircraftIdx = findColumnIndex(headers, ["aircraft", "aircrafticao", "plane"]);
      const routeTypeIdx = findColumnIndex(headers, ["routetype", "type", "flighttype"]);
      const liveryIdx = findColumnIndex(headers, ["livery", "airline", "operatorlivery"]);
      const rankIdx = findColumnIndex(headers, ["rank", "minrank", "minimumrank"]);
      const estFlightTimeIdx = findColumnIndex(headers, ["estflighttime", "flighttime", "time", "duration"]);
      const notesIdx = findColumnIndex(headers, ["notes", "note", "comments"]);

      console.log("CSV Column detection:", {
        headers,
        routeNumberIdx,
        depIcaoIdx,
        arrIcaoIdx,
        aircraftIdx,
        routeTypeIdx,
        liveryIdx,
        rankIdx,
        estFlightTimeIdx,
        notesIdx,
      });

      const routesToParse: ParsedRoute[] = [];
      let skippedRows = 0;
      const skippedDetails: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], delimiter);

        const routeNumber = routeNumberIdx >= 0 ? values[routeNumberIdx] : "";
        const depIcao = depIcaoIdx >= 0 ? values[depIcaoIdx] : "";
        const arrIcao = arrIcaoIdx >= 0 ? values[arrIcaoIdx] : "";
        const aircraftRaw = aircraftIdx >= 0 ? values[aircraftIdx] : "";
        const routeType = normalizeRouteType(routeTypeIdx >= 0 ? values[routeTypeIdx] : "passenger");
        const liveryRaw = liveryIdx >= 0 ? values[liveryIdx] : "";
        const rank = rankIdx >= 0 ? values[rankIdx] : "";
        const estFlightTimeRaw = estFlightTimeIdx >= 0 ? values[estFlightTimeIdx] : "0";
        const notes = notesIdx >= 0 ? values[notesIdx] : "";

        if (!routeNumber || !depIcao || !arrIcao) {
          skippedRows++;
          if (skippedDetails.length < 10) {
            skippedDetails.push(`Row ${i + 1}: ${routeNumber || '(empty)'} - ${depIcao || '(empty)'} -> ${arrIcao || '(empty)'}`);
          }
          continue;
        }

        // Parse flight time (supports both minutes and HH:MM format)
        let estFlightTimeMinutes = 0;
        if (estFlightTimeRaw?.includes(":")) {
          const [hours, mins] = estFlightTimeRaw.split(":").map(Number);
          estFlightTimeMinutes = hours * 60 + mins;
        } else {
          estFlightTimeMinutes = parseInt(estFlightTimeRaw) || 0;
        }

        if (routeNumber && depIcao && arrIcao) {
          const aircraftList = splitRouteAircraft(aircraftRaw);
          const liveryList = splitRouteValues(liveryRaw);

          routesToParse.push({
            route_number: routeNumber,
            dep_icao: depIcao,
            arr_icao: arrIcao,
            aircraft_icao: aircraftList.length > 0 ? aircraftList.join(", ") : undefined,
            livery: liveryList.length > 0 ? liveryList.join(", ") : undefined,
            route_type: routeType,
            est_flight_time_minutes: estFlightTimeMinutes,
            min_rank: rank || undefined,
            notes: notes || undefined,
          });
        }
      }

      if (routesToParse.length === 0) {
        toast.error("No valid routes found in CSV");
        return;
      }

      console.log(`CSV Import: ${routesToParse.length} routes parsed, ${skippedRows} rows skipped`);
      if (skippedRows > 0) {
        console.log("Skipped rows:", skippedDetails);
        toast.info(`${routesToParse.length} routes ready to import (${skippedRows} rows skipped due to missing data)`);
      }

      // Show mapping dialog
      setParsedRoutes(routesToParse);
      setShowMappingDialog(true);
    } catch (error) {
      console.error(error);
      toast.error("Failed to parse CSV");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isAuthError = (error: unknown): boolean => {
    const err = error as { code?: string; message?: string } | null;
    if (!err) return false;
    const errorStr = JSON.stringify(err).toLowerCase();
    return (
      err?.code === 'PGRST116' ||
      err?.code === 'PGRST301' ||
      err?.code === '42501' ||
      errorStr.includes('jwt') ||
      errorStr.includes('token') ||
      errorStr.includes('unauthorized') ||
      errorStr.includes('auth')
    );
  };

  const handleMappingComplete = async (mappedRoutes: ParsedRoute[]) => {
    let refreshAttempted = false;

    type RouteToInsert = {
      route_number: string;
      dep_icao: string;
      arr_icao: string;
      aircraft_icao: string | null;
      livery: string | null;
      route_type: "passenger" | "cargo";
      est_flight_time_minutes: number;
      min_rank: string;
      notes: string | null;
    };

    const isMissingLiveryColumnError = (error: unknown) => {
      const err = error as { code?: string; message?: string } | null;
      return err?.code === "PGRST204" && String(err?.message || "").includes("livery");
    };

    const stripLiveryField = (batch: RouteToInsert[]) =>
      batch.map(({ livery: _livery, ...rest }) => rest);

    let warnedAboutMissingLiveryColumn = false;

    const attemptInsert = async (routes: RouteToInsert[], retryAfterRefresh = false): Promise<{ imported: number; failedBatches: number }> => {
      let imported = 0;
      let failedBatches = 0;
      const BATCH_SIZE = 25;

      for (let i = 0; i < routes.length; i += BATCH_SIZE) {
        const batch = routes.slice(i, i + BATCH_SIZE);
        try {
          let { error } = await supabase.from("routes").insert(batch);

          if (error && isMissingLiveryColumnError(error)) {
            if (!warnedAboutMissingLiveryColumn) {
              toast.warning("Routes livery column is missing in this database. Importing without livery values.");
              warnedAboutMissingLiveryColumn = true;
            }

            const retry = await supabase.from("routes").insert(stripLiveryField(batch));
            error = retry.error;
          }

          if (error) {
            if (isAuthError(error) && !refreshAttempted && !retryAfterRefresh) {
              refreshAttempted = true;
              const { error: refreshError } = await supabase.auth.refreshSession();
              if (!refreshError) {
                return attemptInsert(routes, true);
              }
            }
            console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error, "Routes:", batch.map(r => `${r.route_number} ${r.dep_icao}-${r.arr_icao}`));
            failedBatches++;
            continue;
          }

          imported += batch.length;
        } catch (batchError) {
          if (isAuthError(batchError) && !refreshAttempted && !retryAfterRefresh) {
            refreshAttempted = true;
            const { error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError) {
              return attemptInsert(routes, true);
            }
          }
          console.error(`Batch ${i / BATCH_SIZE + 1} error:`, batchError);
          failedBatches++;
        }
        if (imported % 100 === 0 || i + BATCH_SIZE >= routes.length) {
          toast.info(`Importing... ${imported}/${routes.length}`);
        }
      }

      return { imported, failedBatches };
    };

    try {
      const routesToInsert: RouteToInsert[] = mappedRoutes.map((route) => ({
        route_number: route.route_number,
        dep_icao: route.dep_icao,
        arr_icao: route.arr_icao,
        aircraft_icao: route.aircraft_icao || null,
        livery: route.livery || null,
        route_type: normalizeRouteType(route.route_type),
        est_flight_time_minutes: route.est_flight_time_minutes || 0,
        min_rank: route.min_rank || "cadet",
        notes: route.notes || null,
      }));

      const { imported, failedBatches } = await attemptInsert(routesToInsert);

      queryClient.invalidateQueries({ queryKey: ["admin-routes"] });
      
      console.log(`Import complete: ${imported} imported, ${failedBatches} batches failed out of ${Math.ceil(routesToInsert.length / 25)}`);
      
      if (failedBatches > 0) {
        toast.warning(`${failedBatches} batch(es) failed. ${imported} of ${routesToInsert.length} routes imported. Check console for details.`);
      } else {
        toast.success(`Successfully imported ${imported} routes`);
      }
      setShowMappingDialog(false);
      setParsedRoutes([]);
    } catch (error) {
      console.error(error);
      if (isAuthError(error)) {
        toast.error("Session expired. Please log in again.");
        await supabase.auth.signOut();
        window.location.href = "/auth";
        return;
      }
      toast.error("Failed to import routes");
    }
  };

  const handleMappingCancel = () => {
    setShowMappingDialog(false);
    setParsedRoutes([]);
  };

  const exportCSV = () => {
    if (!routes || routes.length === 0) return;

    const headers = ["routeNumber", "depICAO", "arrICAO", "aircraft", "routeType", "estFlightTime", "rank", "notes"];
    const rows = routes.map((r) => [
      r.route_number,
      r.dep_icao,
      r.arr_icao,
      r.aircraft_icao || "",
      r.route_type,
      r.est_flight_time_minutes,
      r.min_rank,
      r.notes || "",
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "routes.csv";
    a.click();
  };

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  // Show mapping dialog if we have parsed routes
  if (showMappingDialog && parsedRoutes.length > 0) {
    return (
      <div className="space-y-6">
        <RouteImportMapping
          parsedRoutes={parsedRoutes}
          onComplete={handleMappingComplete}
          onCancel={handleMappingCancel}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Manage Routes</h1>
            <p className="text-muted-foreground">Add, edit, and import routes</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            className="hidden"
          />
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button type="button" variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <ConfirmDialog
            trigger={<Button type="button" variant="destructive" disabled={selectedRouteIds.length === 0}>
              <Trash2 className="h-4 w-4 mr-2" /> Bulk Delete ({selectedRouteIds.length})
            </Button>}
            title="Delete selected routes?"
            description="This will permanently remove all selected routes."
            onConfirm={() => bulkDeleteMutation.mutate(selectedRouteIds)}
          />
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button">
                <Plus className="h-4 w-4 mr-2" />
                Add Route
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add New Route</DialogTitle>
                <DialogDescription>Create a new route for the database</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-4 grid-cols-2">
                  <div className="space-y-2">
                    <Label>Route Number</Label>
                    <Input
                      value={newRoute.route_number}
                      onChange={(e) => setNewRoute({ ...newRoute, route_number: e.target.value })}
                      placeholder="AFL001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Aircraft</Label>
                    <Select
                      value={newRoute.aircraft_icao}
                      onValueChange={(v) => setNewRoute({ ...newRoute, aircraft_icao: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {aircraft?.map((ac) => (
                          <SelectItem key={ac.icao_code} value={ac.icao_code}>
                            {ac.icao_code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <div className="space-y-2">
                    <Label>Departure ICAO</Label>
                    <Input
                      value={newRoute.dep_icao}
                      onChange={(e) => setNewRoute({ ...newRoute, dep_icao: e.target.value.toUpperCase() })}
                      placeholder="UUEE"
                      maxLength={4}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Arrival ICAO</Label>
                    <Input
                      value={newRoute.arr_icao}
                      onChange={(e) => setNewRoute({ ...newRoute, arr_icao: e.target.value.toUpperCase() })}
                      placeholder="EGLL"
                      maxLength={4}
                    />
                  </div>
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <div className="space-y-2">
                    <Label>Flight Time (minutes)</Label>
                    <Input
                      type="number"
                      value={newRoute.est_flight_time_minutes}
                      onChange={(e) =>
                        setNewRoute({ ...newRoute, est_flight_time_minutes: parseInt(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={newRoute.route_type}
                      onValueChange={(v) =>
                        setNewRoute({ ...newRoute, route_type: v as "passenger" | "cargo" })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="passenger">Passenger</SelectItem>
                        <SelectItem value="cargo">Cargo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Minimum Rank</Label>
                  <Select
                    value={newRoute.min_rank}
                    onValueChange={(v) => setNewRoute({ ...newRoute, min_rank: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cadet">Cadet</SelectItem>
                      <SelectItem value="first_officer">First Officer</SelectItem>
                      <SelectItem value="captain">Captain</SelectItem>
                      <SelectItem value="senior_captain">Senior Captain</SelectItem>
                      <SelectItem value="commander">Commander</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input
                    value={newRoute.notes}
                    onChange={(e) => setNewRoute({ ...newRoute, notes: e.target.value })}
                    placeholder="Optional notes"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => addRouteMutation.mutate(newRoute)}
                  disabled={addRouteMutation.isPending}
                >
                  Add Route
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Routes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Routes</CardTitle>
          <CardDescription>{routes?.length || 0} routes in database</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : routes && routes.length > 0 ? (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">
                      <Checkbox
                        checked={routes.length > 0 && selectedRouteIds.length === routes.length}
                        onCheckedChange={(checked) => setSelectedRouteIds(checked ? routes.map(r => r.id) : [])}
                      />
                    </th>
                    <th className="text-left py-3 px-2 font-medium">Route</th>
                    <th className="text-left py-3 px-2 font-medium">Dep</th>
                    <th className="text-left py-3 px-2 font-medium">Arr</th>
                    <th className="text-left py-3 px-2 font-medium">Aircraft</th>
                    <th className="text-left py-3 px-2 font-medium">Type</th>
                    <th className="text-left py-3 px-2 font-medium">Time</th>
                    <th className="text-left py-3 px-2 font-medium">Min Rank</th>
                    <th className="text-left py-3 px-2 font-medium">Active</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-2">
                        <Checkbox
                          checked={selectedRouteIds.includes(route.id)}
                          onCheckedChange={(checked) => setSelectedRouteIds(prev => checked ? [...prev, route.id] : prev.filter(id => id !== route.id))}
                        />
                      </td>
                      <td className="py-3 px-2 font-medium">{route.route_number}</td>
                      <td className="py-3 px-2 font-mono">{route.dep_icao}</td>
                      <td className="py-3 px-2 font-mono">{route.arr_icao}</td>
                      <td className="py-3 px-2">
                        <div className="flex flex-col gap-1">
                          {getAircraftLiveryPairs(route.aircraft_icao, route.livery).length > 0 ? (
                            getAircraftLiveryPairs(route.aircraft_icao, route.livery).map((pair, index) => (
                              <span key={`${route.id}-ac-${pair.icao}-${index}`} className="text-xs">
{pair.icao}{pair.livery ? ` - ${pair.livery}` : ""}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2 capitalize">{route.route_type}</td>
                      <td className="py-3 px-2">
                        {Math.floor(route.est_flight_time_minutes / 60)}:
                        {(route.est_flight_time_minutes % 60).toString().padStart(2, "0")}
                      </td>
                      <td className="py-3 px-2 capitalize">{route.min_rank?.replace("_", " ")}</td>
                      <td className="py-3 px-2">
                        <Badge variant={route.is_active ? "default" : "secondary"}>
                          {route.is_active ? "Yes" : "No"}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <ConfirmDialog
                          trigger={
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                          title="Delete Route?"
                          description={`Route ${route.route_number} will be permanently deleted.`}
                          onConfirm={() => deleteRouteMutation.mutate(route.id)}
                        />
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
              <p className="text-sm">Add routes manually or import from CSV</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
